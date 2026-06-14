import Router from "@koa/router";
import { query } from "../db.js";
import { rateLimit, requireString } from "../middleware.js";
import { getKillState, detectBotPattern, flagAccountForReview, approveAccount } from "../services/serving.js";

// Route di piattaforma SENZA auth (l'estensione le consulta a prescindere dal
// login). Rate-limited per IP. Mai esporre dettagli sensibili.
export const platformRouter = new Router();

// Killswitch: l'estensione lo poll-a; killed => ferma il serving / ripristina.
// La versione di CC è accettata per contesto/telemetria futura ma lo stato è globale.
platformRouter.get("/killswitch", rateLimit(120), async (ctx) => {
  const state = await getKillState();
  ctx.body = { killed: !!state.killed, reason: state.reason || "", scope: state.scope || "all" };
});

// Telemetria di salute dell'estensione (best-effort). NIENTE contenuto delle
// conversazioni: solo eventi di lifecycle/diagnostica + versione CC.
platformRouter.post("/telemetry", rateLimit(120), async (ctx) => {
  const body = ctx.request.body || {};
  const event = requireString(ctx, body.event, "event", 64);
  const ccVersion = typeof body.cc_version === "string" ? body.cc_version.slice(0, 64) : null;
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 512) : null;
  const userId = ctx.session?.uid || null;
  await query(
    "INSERT INTO telemetry (user_id, event, cc_version, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [userId, event, ccVersion, detail, Date.now()]
  );
  ctx.body = { ok: true };
});

// --- Admin endpoints (pattern detection, review) ---
// TODO: Aggiungere autenticazione admin prima di esporre in produzione

// Scansiona tutti gli account per pattern bot-like e li flagga
platformRouter.post("/admin/detect-bots", async (ctx) => {
  // TODO: Autenticazione admin
  const users = await query("SELECT id FROM users");
  const flagged = [];

  for (const user of users) {
    const pattern = await detectBotPattern(user.id);
    if (pattern) {
      await flagAccountForReview(user.id, pattern.reason, pattern.score);
      flagged.push({ user_id: user.id, reason: pattern.reason, score: pattern.score });
    }
  }

  ctx.body = { flagged, count: flagged.length };
});

// Approva un account dopo manual review
platformRouter.post("/admin/approve-account", async (ctx) => {
  // TODO: Autenticazione admin
  const body = ctx.request.body || {};
  const userId = body.user_id;
  const reviewedBy = requireString(ctx, body.reviewed_by, "reviewed_by", 255);

  if (!userId) ctx.throw(400, "user_id required");

  await approveAccount(userId, reviewedBy);
  ctx.body = { ok: true, user_id: userId, verdict: 'approved' };
});

// Lista account flaggati per review
platformRouter.get("/admin/flagged-accounts", async (ctx) => {
  // TODO: Autenticazione admin
  const flagged = await query(
    "SELECT user_id, fraud_risk, flagged_reason, flagged_at, reviewed_at, final_verdict FROM account_flags WHERE final_verdict IS NULL ORDER BY flagged_at DESC"
  );
  ctx.body = { flagged };
});

// Debug: ispeziona thinking/impression pattern di un account (per review manuale)
platformRouter.get("/admin/inspect-account/:user_id", async (ctx) => {
  // TODO: Autenticazione admin
  const userId = Number(ctx.params.user_id);
  if (!userId || userId < 1) ctx.throw(400, "invalid_user_id");

  const now = Date.now();
  const dayAgo = now - 86_400_000;

  // Impression dell'ultimo giorno
  const imps = await query(
    "SELECT created_at FROM impressions WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC",
    [userId, dayAgo]
  );

  // Thinking dell'ultimo giorno
  const thinkings = await query(
    "SELECT started_at, finished_at FROM thinking_sessions WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC",
    [userId, dayAgo]
  );

  // Calcola intervalli tra impression
  const intervals = [];
  for (let i = 1; i < imps.length; i++) {
    intervals.push(Number(imps[i].created_at) - Number(imps[i - 1].created_at));
  }

  // Statistiche
  const meanInterval = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  const variance = intervals.length > 0 ? intervals.reduce((sum, x) => sum + Math.pow(x - meanInterval, 2), 0) / intervals.length : 0;
  const stdDev = Math.sqrt(variance);

  ctx.body = {
    user_id: userId,
    impressions_24h: imps.length,
    thinking_sessions_24h: thinkings.length,
    interval_analysis: {
      mean_ms: Math.round(meanInterval),
      stddev_ms: Math.round(stdDev),
      min_ms: intervals.length > 0 ? Math.min(...intervals) : null,
      max_ms: intervals.length > 0 ? Math.max(...intervals) : null,
      suspect: stdDev < 500 ? "HIGH: Regular intervals detected (likely bot)" : "OK: Intervals vary naturally"
    },
    thinking_durations: thinkings.map(t => ({
      started_at: t.started_at,
      finished_at: t.finished_at,
      duration_ms: t.finished_at ? t.finished_at - t.started_at : null
    }))
  };
});
