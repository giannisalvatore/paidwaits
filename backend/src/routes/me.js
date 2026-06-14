import Router from "@koa/router";
import { query, scalar, transaction } from "../db.js";
import { economics, guard } from "../config.js";
import { requireAuth, requireString } from "../middleware.js";
import { balance, earnedSince } from "../services/ledger.js";
import { ownedSession } from "../services/guard.js";

export const meRouter = new Router({ prefix: "/me" });
meRouter.use(requireAuth);

const DAY_MS = 86_400_000;

// Dashboard utente: guadagni, saldo, sessione earning attiva. Solo dati propri.
meRouter.get("/", async (ctx) => {
  const userId = ctx.state.userId;
  const now = Date.now();

  const users = await query("SELECT email, name FROM users WHERE id = ?", [userId]);
  const totalEarned = await scalar(
    "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = 'user' AND account_id = ? AND amount_micros > 0",
    [userId]
  );
  const impressions = await scalar("SELECT COUNT(*) FROM impressions WHERE user_id = ?", [userId]);
  const earningSessions = await query(
    "SELECT device_id FROM sessions WHERE user_id = ? AND earning = 1 AND last_heartbeat > ?",
    [userId, now - guard.HEARTBEAT_TTL_MS]
  );

  ctx.body = {
    email: users[0].email,
    name: users[0].name,
    balance_micros: await balance("user", userId),
    earned_today_micros: await earnedSince(userId, now - DAY_MS),
    earned_month_micros: await earnedSince(userId, now - 30 * DAY_MS),
    earned_total_micros: totalEarned,
    impressions,
    earning_device: earningSessions.length > 0 ? earningSessions[0].device_id : null,
    min_payout_micros: economics.MIN_PAYOUT_MICROS,
  };
});

// Richiesta payout: tutto il saldo, sopra la soglia minima.
// Layer 3: Impression devono essere mature (>7 giorni) + account non flaggato.
meRouter.post("/payout", async (ctx) => {
  const userId = ctx.state.userId;
  const now = Date.now();
  const MATURATION_MS = 7 * 86_400_000;  // 7 giorni

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

  // Conta impression mature (>7 giorni, non ancora in payout)
  const mature = await scalar(
    "SELECT COUNT(*) FROM impressions imp " +
    "JOIN impression_status stat ON stat.impression_id = imp.id " +
    "WHERE imp.user_id = ? AND imp.created_at < ? AND stat.status = 'pending'",
    [userId, now - MATURATION_MS]
  );

  if (mature === 0) ctx.throw(409, "no_mature_impressions");

  const result = await transaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = 'user' AND account_id = ? FOR UPDATE",
      [userId]
    );
    const available = Number(Object.values(rows[0])[0]);
    if (available < economics.MIN_PAYOUT_MICROS) return null;

    const [payout] = await connection.query(
      "INSERT INTO payouts (user_id, amount_micros, status, requested_at) VALUES (?, ?, 'requested', ?)",
      [userId, available, now]
    );
    // Marca impression in questo payout come 'payout_requested'
    await connection.query(
      "UPDATE impression_status SET status = 'payout_requested', updated_at = ? " +
      "WHERE impression_id IN (SELECT id FROM impressions WHERE user_id = ? AND created_at < ?) " +
      "AND status = 'pending'",
      [now, userId, now - MATURATION_MS]
    );
    await connection.query(
      "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('user', ?, ?, 'payout', ?, ?)",
      [userId, -available, String(payout.insertId), now]
    );
    return { id: payout.insertId, amount_micros: available };
  });

  if (!result) ctx.throw(409, "below_minimum_payout");
  ctx.body = result;
});

meRouter.get("/payouts", async (ctx) => {
  const payouts = await query(
    "SELECT id, amount_micros, status, requested_at, processed_at FROM payouts WHERE user_id = ? ORDER BY requested_at DESC",
    [ctx.state.userId]
  );
  ctx.body = { payouts };
});

// Layer 1: Notifica che il thinking è iniziato (PreToolUse hook da Claude Code).
// Valida che sia il primo thinking da questa sessione negli ultimi 120s (no doppi thinking).
meRouter.post("/thinking-start", async (ctx) => {
  const userId = ctx.state.userId;
  const sessionId = requireString(ctx, ctx.request.body?.session_id, "session_id", 36);
  const session = await ownedSession(userId, sessionId);
  if (!session) ctx.throw(404, "session_not_found");

  const now = Date.now();

  // Controlla: è già stato creato un ad_request da questa sessione negli ultimi 120s?
  const recent = await scalar(
    "SELECT COUNT(*) FROM ad_requests WHERE session_id = ? AND created_at > ?",
    [sessionId, now - 120_000]
  );

  if (recent > 0) ctx.throw(409, "thinking_already_active");

  // Registra il thinking: crea una nuova riga (una per ogni thinking)
  // Valido per 120 secondi (copre il thinking + buffer network)
  await query(
    "INSERT INTO thinking_sessions (user_id, session_id, started_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [userId, sessionId, now, now + 120_000, now]
  );

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
    "SELECT id, session_id, started_at, finished_at, TIMESTAMPDIFF(SECOND, FROM_UNIXTIME(started_at/1000), FROM_UNIXTIME(COALESCE(finished_at, UNIX_TIMESTAMP()*1000)/1000)) as duration_sec FROM thinking_sessions WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC",
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
