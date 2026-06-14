import Router from "@koa/router";
import { OAuth2Client } from "google-auth-library";
import { query } from "../db.js";
import { config } from "../config.js";
import { rateLimit, requireAuth, requireString } from "../middleware.js";
import { upsertUser, issueMagicLink, consumeMagicLink } from "../services/accounts.js";

export const authRouter = new Router({ prefix: "/auth" });
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

authRouter.use(rateLimit(20));

// Login reale: il client manda l'ID token di Google Identity Services.
authRouter.post("/google", async (ctx) => {
  if (!googleClient) ctx.throw(503, "google_auth_not_configured");
  const idToken = requireString(ctx, ctx.request.body?.id_token, "id_token", 4096);
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientId });
    payload = ticket.getPayload();
  } catch {
    ctx.throw(401, "invalid_google_token");
  }
  if (!payload?.sub || !payload?.email || !payload?.email_verified) ctx.throw(401, "invalid_google_token");

  ctx.session.uid = await upsertUser({ googleSub: payload.sub, email: payload.email, name: payload.name || null });
  ctx.body = { ok: true };
});

// Magic link inserzionisti: richiesta. Risponde sempre ok (no enumeration).
// In dev (DEV_LOGIN) include il link nella risposta per comodità di test.
authRouter.post("/magic/request", async (ctx) => {
  const email = requireString(ctx, ctx.request.body?.email, "email", 255).toLowerCase();
  const { url } = await issueMagicLink(email);
  ctx.body = { ok: true, ...(config.devLogin ? { dev_link: url } : {}) };
});

// Magic link: verifica il token e apre la sessione.
authRouter.post("/magic/verify", async (ctx) => {
  const token = requireString(ctx, ctx.request.body?.token, "token", 128);
  const userId = await consumeMagicLink(token);
  if (!userId) ctx.throw(401, "invalid_or_expired_link");
  ctx.session.uid = userId;
  ctx.body = { ok: true };
});

// Login di sviluppo: attivo solo con DEV_LOGIN=true, mai in produzione.
authRouter.post("/dev", async (ctx) => {
  if (!config.devLogin || config.isProduction) ctx.throw(404, "not_found");
  const email = requireString(ctx, ctx.request.body?.email, "email", 255).toLowerCase();
  ctx.session.uid = await upsertUser({ googleSub: null, email, name: email.split("@")[0] });
  ctx.body = { ok: true };
});

// Solo i dati propri, mai google_sub.
authRouter.get("/me", requireAuth, async (ctx) => {
  const rows = await query("SELECT id, email, name FROM users WHERE id = ?", [ctx.state.userId]);
  if (rows.length === 0) ctx.throw(401, "unauthorized");
  ctx.body = rows[0];
});

authRouter.post("/logout", requireAuth, async (ctx) => {
  ctx.session = null;
  ctx.body = { ok: true };
});
