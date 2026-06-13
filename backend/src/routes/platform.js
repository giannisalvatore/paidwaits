import Router from "@koa/router";
import { query } from "../db.js";
import { rateLimit, requireString } from "../middleware.js";
import { getKillState } from "../services/serving.js";

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
