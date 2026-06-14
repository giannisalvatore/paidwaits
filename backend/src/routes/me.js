import Router from "@koa/router";
import { query, scalar, transaction } from "../db.js";
import { config, economics, guard } from "../config.js";
import { requireAuth, requireString } from "../middleware.js";
import { balance, earnedSince } from "../services/ledger.js";
import { ownedSession } from "../services/guard.js";
import {
  stripeEnabled,
  createConnectAccount,
  createAccountLink,
  retrieveAccount,
  createTransfer,
} from "../services/stripe.js";

export const meRouter = new Router({ prefix: "/me" });
meRouter.use(requireAuth);

const DAY_MS = 86_400_000;
const MATURATION_MS = 7 * DAY_MS;   // impression prelevabili solo dopo 7 giorni
const THINKING_TTL_MS = 120_000;    // finestra di validità di un thinking (estesa a ogni tool)

// Dashboard utente: guadagni, saldo, sessione earning attiva. Solo dati propri.
meRouter.get("/", async (ctx) => {
  const userId = ctx.state.userId;
  const now = Date.now();

  const users = await query(
    "SELECT email, name, stripe_account_id, payouts_enabled FROM users WHERE id = ?",
    [userId]
  );
  const totalEarned = await scalar(
    "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = 'user' AND account_id = ? AND amount_micros > 0",
    [userId]
  );
  const impressions = await scalar("SELECT COUNT(*) FROM impressions WHERE user_id = ?", [userId]);
  // Quota effettivamente prelevabile: impression mature (>7gg) ancora 'pending'.
  const withdrawable = await scalar(
    "SELECT COALESCE(SUM(imp.user_share_micros), 0) FROM impressions imp " +
    "JOIN impression_status stat ON stat.impression_id = imp.id " +
    "WHERE imp.user_id = ? AND imp.created_at < ? AND stat.status = 'pending'",
    [userId, now - MATURATION_MS]
  );
  const earningSessions = await query(
    "SELECT device_id FROM sessions WHERE user_id = ? AND earning = 1 AND last_heartbeat > ?",
    [userId, now - guard.HEARTBEAT_TTL_MS]
  );

  // Earning limits a finestre fisse (allineate all'enforcement in ads.js).
  const d = new Date(now);
  const startOfHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  // Serie giornaliera dei guadagni (user_share) ultimi 14 giorni, per il grafico.
  const seriesRows = await query(
    "SELECT (created_at DIV 86400000) AS day_idx, COALESCE(SUM(user_share_micros), 0) AS micros " +
    "FROM impressions WHERE user_id = ? AND created_at >= ? GROUP BY day_idx ORDER BY day_idx",
    [userId, startOfDay - 13 * DAY_MS]
  );
  const byDay = new Map(seriesRows.map((r) => [Number(r.day_idx), Number(r.micros)]));
  const todayIdx = Math.floor(now / DAY_MS);
  const earningsSeries = [];
  for (let i = 13; i >= 0; i -= 1) {
    const idx = todayIdx - i;
    earningsSeries.push({ day: idx * DAY_MS, value: byDay.get(idx) || 0 });
  }

  ctx.body = {
    email: users[0].email,
    name: users[0].name,
    balance_micros: await balance("user", userId),
    withdrawable_micros: withdrawable,   // prelevabile ora (mature); il resto matura a 7gg
    earned_hour_micros: await earnedSince(userId, startOfHour),
    earned_today_micros: await earnedSince(userId, startOfDay),
    earned_month_micros: await earnedSince(userId, now - 30 * DAY_MS),
    earned_total_micros: totalEarned,
    earn_hour_cap_micros: guard.EARN_HOUR_CAP_MICROS,
    earn_day_cap_micros: guard.EARN_DAY_CAP_MICROS,
    hour_reset_at: startOfHour + 3_600_000,
    day_reset_at: startOfDay + DAY_MS,
    earnings_series: earningsSeries,
    impressions,
    earning_device: earningSessions.length > 0 ? earningSessions[0].device_id : null,
    min_payout_micros: economics.MIN_PAYOUT_MICROS,
    // Stato payout (Stripe Connect). In dev (no Stripe) i payout sono sempre abilitati.
    payout_connected: stripeEnabled() ? !!users[0].stripe_account_id : true,
    payouts_enabled: stripeEnabled() ? !!users[0].payouts_enabled : true,
  };
});

// Avvia/riprende l'onboarding Stripe Express (KYC + IBAN ospitati da Stripe).
meRouter.post("/connect/onboard", async (ctx) => {
  const userId = ctx.state.userId;
  if (!stripeEnabled()) {
    ctx.body = { url: `${config.appUrl}/dashboard?connect=dev`, dev: true };
    return;
  }
  const rows = await query("SELECT email, stripe_account_id FROM users WHERE id = ?", [userId]);
  let accountId = rows[0]?.stripe_account_id;
  if (!accountId) {
    const account = await createConnectAccount(rows[0].email);
    accountId = account.id;
    await query("UPDATE users SET stripe_account_id = ? WHERE id = ?", [accountId, userId]);
  }
  const link = await createAccountLink(
    accountId,
    `${config.appUrl}/dashboard?connect=refresh`,
    `${config.appUrl}/dashboard?connect=return`
  );
  ctx.body = { url: link.url };
});

// Stato connessione payout. Sincronizza payouts_enabled da Stripe (polling, no webhook).
meRouter.get("/connect/status", async (ctx) => {
  const userId = ctx.state.userId;
  if (!stripeEnabled()) {
    ctx.body = { connected: true, payouts_enabled: true, dev: true };
    return;
  }
  const rows = await query("SELECT stripe_account_id, payouts_enabled FROM users WHERE id = ?", [userId]);
  const accountId = rows[0]?.stripe_account_id || null;
  let payoutsEnabled = !!rows[0]?.payouts_enabled;
  if (accountId && !payoutsEnabled) {
    try {
      const account = await retrieveAccount(accountId);
      payoutsEnabled = !!account.payouts_enabled;
      if (payoutsEnabled) await query("UPDATE users SET payouts_enabled = 1 WHERE id = ?", [userId]);
    } catch {
      // best-effort: se Stripe non risponde, restiamo sullo stato in DB
    }
  }
  ctx.body = { connected: !!accountId, payouts_enabled: payoutsEnabled };
});

// Richiesta payout: SOLO la quota delle impression mature (>7 giorni), sopra la soglia.
// Layer 3: i guadagni freschi NON sono prelevabili finché non maturano (finestra di
// review). Si preleva esattamente la somma di user_share delle impression mature
// ancora 'pending'; quelle vengono marcate 'payout_requested' nella stessa transazione.
meRouter.post("/payout", async (ctx) => {
  const userId = ctx.state.userId;
  const now = Date.now();
  const maturedBefore = now - MATURATION_MS;

  // Controlla account flags: se under review o suspended, rifiuta payout
  const flags = await query(
    "SELECT final_verdict, fraud_risk FROM account_flags WHERE user_id = ?",
    [userId]
  );
  if (flags.length > 0) {
    const flag = flags[0];
    if (flag.final_verdict === 'suspended') ctx.throw(403, "account_suspended");
    if (flag.final_verdict === 'rejected') ctx.throw(403, "account_rejected");
    if (flag.final_verdict === null && flag.fraud_risk === 'high') {
      ctx.throw(403, "account_under_review");  // Review in corso
    }
  }

  // Connect: con Stripe attivo il payout richiede KYC completato (payouts_enabled).
  let accountId = null;
  if (stripeEnabled()) {
    const u = await query("SELECT stripe_account_id, payouts_enabled FROM users WHERE id = ?", [userId]);
    if (!u[0]?.stripe_account_id || !u[0]?.payouts_enabled) ctx.throw(403, "payouts_not_enabled");
    accountId = u[0].stripe_account_id;
  }

  const initialStatus = stripeEnabled() ? "processing" : "requested";
  const result = await transaction(async (connection) => {
    // Blocca le impression mature ancora 'pending' (evita doppio prelievo concorrente).
    const [matureRows] = await connection.query(
      "SELECT imp.id, imp.user_share_micros FROM impressions imp " +
      "JOIN impression_status stat ON stat.impression_id = imp.id " +
      "WHERE imp.user_id = ? AND imp.created_at < ? AND stat.status = 'pending' FOR UPDATE",
      [userId, maturedBefore]
    );
    if (matureRows.length === 0) return { error: "no_mature_impressions" };

    const matureMicros = matureRows.reduce((sum, r) => sum + Number(r.user_share_micros), 0);
    if (matureMicros < economics.MIN_PAYOUT_MICROS) return { error: "below_minimum_payout" };

    const [payout] = await connection.query(
      "INSERT INTO payouts (user_id, amount_micros, status, requested_at) VALUES (?, ?, ?, ?)",
      [userId, matureMicros, initialStatus, now]
    );
    const ids = matureRows.map((r) => r.id);
    await connection.query(
      "UPDATE impression_status SET status = 'payout_requested', updated_at = ? WHERE impression_id IN (?) AND status = 'pending'",
      [now, ids]
    );
    await connection.query(
      "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('user', ?, ?, 'payout', ?, ?)",
      [userId, -matureMicros, String(payout.insertId), now]
    );
    return { id: payout.insertId, amount_micros: matureMicros, ids };
  });

  if (result.error) ctx.throw(409, result.error);

  // Transfer reale piattaforma → connected account (post-commit). In dev resta 'requested'.
  if (stripeEnabled()) {
    try {
      const transfer = await createTransfer({
        amountMicros: result.amount_micros,
        destinationAccountId: accountId,
        metadata: { payout_id: result.id, user_id: userId },
      });
      await query("UPDATE payouts SET status = 'paid', stripe_transfer_id = ?, processed_at = ? WHERE id = ?", [
        transfer.id,
        Date.now(),
        result.id,
      ]);
    } catch {
      // Compensazione: il transfer è fallito → rimborsa a ledger, riporta le impression
      // a 'pending' e segna il payout come rejected (niente soldi persi nel sistema).
      const ts = Date.now();
      await query("UPDATE payouts SET status = 'rejected', processed_at = ? WHERE id = ?", [ts, result.id]);
      await query(
        "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('user', ?, ?, 'payout_reversal', ?, ?)",
        [userId, result.amount_micros, String(result.id), ts]
      );
      if (result.ids.length) {
        await query(
          "UPDATE impression_status SET status = 'pending', updated_at = ? WHERE impression_id IN (?) AND status = 'payout_requested'",
          [ts, result.ids]
        );
      }
      ctx.throw(502, "payout_transfer_failed");
    }
  }

  ctx.body = { id: result.id, amount_micros: result.amount_micros };
});

meRouter.get("/payouts", async (ctx) => {
  const payouts = await query(
    "SELECT id, amount_micros, status, requested_at, processed_at FROM payouts WHERE user_id = ? ORDER BY requested_at DESC",
    [ctx.state.userId]
  );
  ctx.body = { payouts };
});

// Layer 1: Notifica che il thinking è iniziato (PreToolUse hook da Claude Code).
// PreToolUse scatta a OGNI tool dello stesso turno: se c'è già un thinking ATTIVO per
// questa sessione (non finito, non scaduto) estendiamo solo la finestra di validità —
// così il thinking resta valido per tutta la durata del turno senza strozzare il
// serving degli ad. Solo all'inizio di un nuovo turno creiamo una riga nuova.
meRouter.post("/thinking-start", async (ctx) => {
  const userId = ctx.state.userId;
  const sessionId = requireString(ctx, ctx.request.body?.session_id, "session_id", 36);
  const session = await ownedSession(userId, sessionId);
  if (!session) ctx.throw(404, "session_not_found");

  const now = Date.now();
  const expiresAt = now + THINKING_TTL_MS;

  // Prova a estendere un thinking già attivo di questa sessione.
  const extended = await query(
    "UPDATE thinking_sessions SET expires_at = ? WHERE user_id = ? AND session_id = ? AND finished_at IS NULL AND expires_at > ?",
    [expiresAt, userId, sessionId, now]
  );

  // Nessun thinking attivo da estendere → nuovo turno → nuova riga.
  if (extended.affectedRows === 0) {
    await query(
      "INSERT INTO thinking_sessions (user_id, session_id, started_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [userId, sessionId, now, expiresAt, now]
    );
  }

  ctx.body = { ok: true };
});

// Notifica che il thinking è finito. Registra finished_at (per debugging/analytics).
meRouter.post("/thinking-stop", async (ctx) => {
  const userId = ctx.state.userId;
  const sessionId = requireString(ctx, ctx.request.body?.session_id, "session_id", 36);

  // Aggiorna l'ultimo thinking non-finito di questa sessione
  await query(
    "UPDATE thinking_sessions SET finished_at = ? WHERE user_id = ? AND session_id = ? AND finished_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [Date.now(), userId, sessionId]
  );

  ctx.body = { ok: true };
});

// Debug/Analytics: mostra la storia dei thinking dell'utente (ultimi 7 giorni)
meRouter.get("/thinking-history", async (ctx) => {
  const userId = ctx.state.userId;
  const since = Date.now() - 7 * 86_400_000;

  const thinkings = await query(
    "SELECT id, session_id, started_at, finished_at, expires_at, TIMESTAMPDIFF(SECOND, FROM_UNIXTIME(started_at/1000), FROM_UNIXTIME(COALESCE(finished_at, UNIX_TIMESTAMP()*1000)/1000)) as duration_sec FROM thinking_sessions WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC",
    [userId, since]
  );

  // Calcola stats
  const activeTodayCount = thinkings.filter(t => t.finished_at && t.finished_at > Date.now() - 86_400_000).length;
  const totalThinkings = thinkings.length;

  ctx.body = {
    total_thinkings_7d: totalThinkings,
    active_today: activeTodayCount,
    thinkings: thinkings.map(t => ({
      id: t.id,
      session_id: t.session_id,
      started_at: t.started_at,
      finished_at: t.finished_at,
      duration_seconds: t.duration_sec || null,
      is_active: t.finished_at === null && t.expires_at > Date.now()
    }))
  };
});
