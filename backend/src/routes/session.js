import Router from "@koa/router";
import { requireAuth, requireString } from "../middleware.js";
import { startSession, heartbeat } from "../services/guard.js";

export const sessionRouter = new Router({ prefix: "/session" });
sessionRouter.use(requireAuth);

// L'estensione apre una sessione all'avvio e riceve l'id generato dal server.
sessionRouter.post("/start", async (ctx) => {
  const deviceId = requireString(ctx, ctx.request.body?.device_id, "device_id", 128);
  const sessionId = await startSession(ctx.state.userId, deviceId);
  ctx.body = { session_id: sessionId };
});

// Heartbeat ogni ~30s: tiene viva la sessione e risolve chi e la sessione earning.
sessionRouter.post("/heartbeat", async (ctx) => {
  const sessionId = requireString(ctx, ctx.request.body?.session_id, "session_id", 36);
  const result = await heartbeat(ctx.state.userId, sessionId);
  if (!result) ctx.throw(404, "session_not_found");
  ctx.body = result;
});
