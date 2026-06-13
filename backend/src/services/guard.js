import { randomUUID } from "node:crypto";
import { query } from "../db.js";
import { guard } from "../config.js";

// Crea una nuova sessione dell'estensione per l'utente.
export async function startSession(userId, deviceId) {
  const id = randomUUID();
  const now = Date.now();
  await query(
    "INSERT INTO sessions (id, user_id, device_id, earning, last_heartbeat, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    [id, userId, deviceId, now, now]
  );
  return id;
}

// Ritorna la sessione solo se appartiene all'utente (ownership check sempre).
export async function ownedSession(userId, sessionId) {
  const rows = await query("SELECT id, user_id, earning, last_heartbeat FROM sessions WHERE id = ? AND user_id = ?", [
    sessionId,
    userId,
  ]);
  return rows[0] || null;
}

// Heartbeat: aggiorna la sessione e applica il session guard.
// Regola: una sola sessione "earning" per utente. La prima sessione viva la prende;
// se muore (heartbeat scaduto), un'altra puo subentrare ma solo dopo il cooldown.
export async function heartbeat(userId, sessionId) {
  const session = await ownedSession(userId, sessionId);
  if (!session) return null;

  const now = Date.now();
  await query("UPDATE sessions SET last_heartbeat = ? WHERE id = ?", [now, sessionId]);

  const aliveAfter = now - guard.HEARTBEAT_TTL_MS;
  const earningRows = await query(
    "SELECT id FROM sessions WHERE user_id = ? AND earning = 1 AND last_heartbeat > ?",
    [userId, aliveAfter]
  );

  if (earningRows.length > 0) {
    return { earning: earningRows[0].id === sessionId };
  }

  // Nessuna sessione earning viva: questa puo subentrare se il cooldown e passato.
  const switches = await query("SELECT session_id, switched_at FROM earning_switches WHERE user_id = ?", [userId]);
  const last = switches[0];
  if (last && last.session_id !== sessionId && now - last.switched_at < guard.EARNING_COOLDOWN_MS) {
    return { earning: false };
  }

  await query("UPDATE sessions SET earning = 0 WHERE user_id = ?", [userId]);
  await query("UPDATE sessions SET earning = 1 WHERE id = ?", [sessionId]);
  await query(
    "INSERT INTO earning_switches (user_id, session_id, switched_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), switched_at = VALUES(switched_at)",
    [userId, sessionId, now]
  );
  return { earning: true };
}

// La sessione e viva e attualmente earning?
export async function isEarning(userId, sessionId) {
  const session = await ownedSession(userId, sessionId);
  if (!session) return false;
  return session.earning === 1 && Date.now() - session.last_heartbeat < guard.HEARTBEAT_TTL_MS;
}
