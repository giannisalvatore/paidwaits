import { scalar } from "../db.js";
import { economics } from "../config.js";

// Saldo di un account = somma delle scritture del ledger. Fonte di verità unica.
export function balance(accountType, accountId) {
  return scalar(
    "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = ? AND account_id = ?",
    [accountType, accountId]
  );
}

// Scrive le gambe di un evento pagato dentro una transazione. Somma = 0.
// Impression: addebito inserzionista, 50% all'utente, 50% alla piattaforma.
// Click: addebito inserzionista, 100% alla piattaforma (i click non pagano l'utente).
export async function recordSpend(connection, { refType, refId, advertiserId, userId, costMicros }) {
  const userShare = refType === "impression" ? Math.floor(costMicros * economics.USER_SHARE) : 0;
  const platformShare = costMicros - userShare;
  const now = Date.now();
  const insert =
    "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)";
  await connection.query(insert, ["advertiser", advertiserId, -costMicros, refType, refId, now]);
  if (userShare > 0) await connection.query(insert, ["user", userId, userShare, refType, refId, now]);
  await connection.query(insert, ["platform", 0, platformShare, refType, refId, now]);
  return userShare;
}

// Guadagno utente nelle ultime 24h (per il cap giornaliero). Solo impression: i click non pagano l'utente.
export function earnedSince(userId, sinceMs) {
  return scalar(
    "SELECT COALESCE(SUM(amount_micros), 0) FROM ledger WHERE account_type = 'user' AND account_id = ? AND ref_type = 'impression' AND created_at >= ?",
    [userId, sinceMs]
  );
}
