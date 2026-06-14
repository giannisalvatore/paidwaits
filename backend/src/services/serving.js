import { query, scalar } from "../db.js";
import { ops, guard } from "../config.js";

// --- Killswitch / serving gate ------------------------------------------------
// Stato di kill globale: env KILLSWITCH (emergenza, vince sempre) OPPURE il flag
// 'killswitch' in platform_flags (JSON {killed,reason,scope}). Cache in memoria
// (TTL breve) per non interrogare il DB a ogni /ad/next.

let killCache = { value: null, at: 0 };
const KILL_CACHE_MS = 10_000;

async function readKillFlag() {
  const rows = await query("SELECT flag_value FROM platform_flags WHERE flag_key = 'killswitch'");
  if (rows.length === 0) return { killed: false };
  try {
    const v = JSON.parse(rows[0].flag_value || "{}");
    return { killed: !!v.killed, reason: v.reason, scope: v.scope };
  } catch {
    return { killed: false };
  }
}

// {killed, reason, scope}. Mai lancia: in caso di errore DB resta "non killed"
// (il backend è raggiungibile; l'env kill copre l'emergenza certa).
export async function getKillState() {
  if (ops.envKill) return { killed: true, reason: ops.envKillReason, scope: "all" };
  const now = Date.now();
  if (killCache.value && now - killCache.at < KILL_CACHE_MS) return killCache.value;
  let state;
  try {
    state = await readKillFlag();
  } catch {
    state = { killed: false };
  }
  killCache = { value: state, at: now };
  return state;
}

// Imposta/azzera il killswitch da DB (usabile da un futuro endpoint admin o a mano).
export async function setKillState({ killed, reason = "", scope = "all" }) {
  const value = JSON.stringify({ killed: !!killed, reason, scope });
  await query(
    "INSERT INTO platform_flags (flag_key, flag_value, updated_at) VALUES ('killswitch', ?, ?) " +
    "ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value), updated_at = VALUES(updated_at)",
    [value, Date.now()]
  );
  killCache = { value: { killed: !!killed, reason, scope }, at: Date.now() };
}

// --- Billing idempotente ------------------------------------------------------
// Registra un evento billabile per event_uuid. Ritorna true se NUOVO (procedi a
// fatturare), false se DUPLICATO (replay → non rifatturare). Usa la PK come lock.
// Va chiamata DENTRO la stessa transaction della scrittura billing.
export async function claimBillingEvent(connection, { eventUuid, kind, userId, refId }) {
  try {
    await connection.query(
      "INSERT INTO billing_events (event_uuid, kind, user_id, ref_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [eventUuid, kind, userId, refId, Date.now()]
    );
    return true;
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") return false; // replay dello stesso evento
    // Fail-open se la tabella non esiste ancora (migrazione non eseguita): non
    // dedup, ma non rompiamo il billing (l'unicità di ad_request_id/impression_id
    // resta come dedup di base).
    if (e && e.code === "ER_NO_SUCH_TABLE") return true;
    throw e;
  }
}

const EVENT_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isValidEventUuid(v) {
  return typeof v === "string" && EVENT_UUID_RE.test(v);
}

// --- Pattern detection: Bot-like behavior flagging ---
// Rileva pattern sospetti e flagga account ad alto rischio frode.
export async function detectBotPattern(userId) {
  const now = Date.now();
  const dayAgo = now - 86_400_000;

  // Controlla impression dell'ultimo giorno
  const impressions = await query(
    "SELECT created_at FROM impressions WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC",
    [userId, dayAgo]
  );

  if (impressions.length < 50) return null; // Poco traffico, non diagnosticare

  // Analizza gli intervalli tra impression
  const intervals = [];
  for (let i = 1; i < impressions.length; i++) {
    intervals.push(Number(impressions[i].created_at) - Number(impressions[i - 1].created_at));
  }

  // Calcola deviazione standard degli intervalli
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, x) => sum + Math.pow(x - meanInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  // Red flag: intervalli troppo regolari (stdDev < 500ms = perfetto bot-like)
  if (stdDev < 500) {
    return {
      reason: `Regular intervals detected (stdDev=${Math.round(stdDev)}ms)`,
      score: 'high'
    };
  }

  // Orange flag: molte impression in poco tempo (>300 al giorno)
  if (impressions.length > 300) {
    return {
      reason: `High volume: ${impressions.length} impressions in 24h`,
      score: 'medium'
    };
  }

  return null;
}

// Flagga un account come sospetto (frode_risk, ragione, etc.)
export async function flagAccountForReview(userId, reason, riskScore = 'medium') {
  await query(
    "INSERT INTO account_flags (user_id, fraud_risk, flagged_reason, flagged_at) VALUES (?, ?, ?, ?) " +
    "ON DUPLICATE KEY UPDATE fraud_risk = ?, flagged_reason = ?, flagged_at = ?",
    [userId, riskScore, reason, Date.now(), riskScore, reason, Date.now()]
  );
}

// Approva un account come safe (dopo manual review)
export async function approveAccount(userId, reviewedBy) {
  await query(
    "INSERT INTO account_flags (user_id, final_verdict, reviewed_by, reviewed_at) VALUES (?, 'approved', ?, ?) " +
    "ON DUPLICATE KEY UPDATE final_verdict = 'approved', reviewed_by = ?, reviewed_at = ?",
    [userId, reviewedBy, Date.now(), reviewedBy, Date.now()]
  );
}

// --- Cooldown anti-burst ------------------------------------------------------
// True se è passato abbastanza tempo dall'ultima impression PAGATA dell'utente.
export async function impressionCooldownOk(userId, now) {
  const last = await scalar(
    "SELECT MAX(created_at) FROM impressions WHERE user_id = ?",
    [userId]
  );
  return last === 0 || now - last >= guard.IMP_COOLDOWN_MS;
}
