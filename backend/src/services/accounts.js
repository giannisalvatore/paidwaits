import { randomBytes } from "node:crypto";
import { query } from "../db.js";
import { config } from "../config.js";
import { sendEmail, magicLinkEmail } from "./mailer.js";

const MAGIC_TTL_MS = 30 * 60_000; // 30 minuti

// Crea o aggiorna un utente per email. google_sub valorizzato solo per login Google.
export async function upsertUser({ googleSub = null, email, name = null }) {
  const existing = await query("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) {
    if (googleSub) {
      await query("UPDATE users SET google_sub = ?, name = ? WHERE id = ?", [googleSub, name, existing[0].id]);
    }
    return existing[0].id;
  }
  const result = await query("INSERT INTO users (google_sub, email, name, created_at) VALUES (?, ?, ?, ?)", [
    googleSub,
    email,
    name,
    Date.now(),
  ]);
  return result.insertId;
}

// Genera un magic link per l'email indicata e lo invia (o lo logga in dev).
export async function issueMagicLink(email) {
  const userId = await upsertUser({ email, name: email.split("@")[0] });
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await query(
    "INSERT INTO magic_link_tokens (token, email, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [token, email, userId, now + MAGIC_TTL_MS, now]
  );
  const url = `${config.appUrl}/advertiser/auth?token=${token}`;
  await sendEmail({ to: email, ...magicLinkEmail(url) });
  return { userId, token, url };
}

// Valida e consuma un magic link. Ritorna user_id o null.
export async function consumeMagicLink(token) {
  const now = Date.now();
  const rows = await query("SELECT user_id, expires_at, used_at FROM magic_link_tokens WHERE token = ?", [token]);
  if (rows.length === 0 || rows[0].used_at || Number(rows[0].expires_at) < now) return null;
  await query("UPDATE magic_link_tokens SET used_at = ? WHERE token = ?", [now, token]);
  return Number(rows[0].user_id);
}
