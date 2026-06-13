import { query } from "./db.js";

// Error handler globale: mai esporre dettagli interni al client.
export async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (error) {
    ctx.status = error.status || 500;
    ctx.body = { error: error.expose ? error.message : "internal_error" };
    if (ctx.status === 500) console.error(error);
  }
}

// Tutte le route di business stanno dietro la sessione. Verifica che l'utente
// esista ancora: una sessione orfana (es. utente cancellato) viene azzerata → 401,
// invece di propagare un errore a valle.
export async function requireAuth(ctx, next) {
  if (!ctx.session.uid) ctx.throw(401, "unauthorized");
  const rows = await query("SELECT id FROM users WHERE id = ?", [ctx.session.uid]);
  if (rows.length === 0) {
    ctx.session = null;
    ctx.throw(401, "unauthorized");
  }
  ctx.state.userId = ctx.session.uid;
  await next();
}

// Rate limit in-memory per gli endpoint di auth (niente brute force).
const hits = new Map();
export function rateLimit(maxPerMinute) {
  return async (ctx, next) => {
    const now = Date.now();
    const key = ctx.ip;
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + 60_000 });
    } else if (++entry.count > maxPerMinute) {
      ctx.throw(429, "too_many_requests");
    }
    await next();
  };
}

// Validazione input minimale: ritorna la stringa o lancia 400.
export function requireString(ctx, value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    ctx.throw(400, `invalid_${name}`);
  }
  return value.trim();
}

export function requireNumber(ctx, value, name, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    ctx.throw(400, `invalid_${name}`);
  }
  return parsed;
}

export function requireHttpsUrl(ctx, value, name) {
  const raw = requireString(ctx, value, name, 2048);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    ctx.throw(400, `invalid_${name}`);
  }
  if (parsed.protocol !== "https:") ctx.throw(400, `invalid_${name}`);
  return parsed.href;
}
