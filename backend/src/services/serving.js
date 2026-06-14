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
    // Fail-CLOSED: per il denaro il fallimento sicuro è FERMARSI, non fatturare.
    // Se la tabella billing_events manca (migrazione non eseguita) propaghiamo
    // l'errore: la transazione del billing fa rollback e l'evento NON viene
    // fatturato (meglio non contare che contare due volte). Eseguire `npm run migrate`.
    throw e;
  }
}

const EVENT_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isValidEventUuid(v) {
  return typeof v === "string" && EVENT_UUID_RE.test(v);
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
