import Router from "@koa/router";
import { query, scalar, transaction } from "../db.js";
import { economics, guard } from "../config.js";
import { requireAuth } from "../middleware.js";
import { balance, earnedSince } from "../services/ledger.js";

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

// Richiesta payout: tutto il saldo, sopra la soglia minima. Elaborazione manuale/batch (MVP).
meRouter.post("/payout", async (ctx) => {
  const userId = ctx.state.userId;
  const result = await transaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = 'user' AND account_id = ? FOR UPDATE",
      [userId]
    );
    const available = Number(Object.values(rows[0])[0]);
    if (available < economics.MIN_PAYOUT_MICROS) return null;

    const now = Date.now();
    const [payout] = await connection.query(
      "INSERT INTO payouts (user_id, amount_micros, status, requested_at) VALUES (?, ?, 'requested', ?)",
      [userId, available, now]
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
