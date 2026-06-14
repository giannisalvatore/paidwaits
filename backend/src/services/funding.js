import { query } from "../db.js";
import { issueMagicLink } from "./accounts.js";

// Finalizza una campagna pagata: paid=1, registra il deposito, invia il magic link.
// Idempotente (no doppio deposito/link se già finalizzata). Ritorna true se ha agito.
export async function finalizeCampaign(campaignId, advertiserId, fundedMicros, email) {
  const rows = await query("SELECT paid FROM campaigns WHERE id = ?", [campaignId]);
  if (rows.length === 0 || rows[0].paid === 1) return false;
  await query("UPDATE campaigns SET paid = 1 WHERE id = ?", [campaignId]);
  await query(
    "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('advertiser', ?, ?, 'deposit', ?, ?)",
    [advertiserId, fundedMicros, `campaign:${campaignId}`, Date.now()]
  );
  if (email) await issueMagicLink(email);
  return true;
}

// Finalizza a partire da una Checkout Session Stripe (metadata.campaign_id).
export async function finalizeCampaignBySession(session) {
  const campaignId = Number(session.metadata?.campaign_id);
  if (!campaignId) return false;
  const rows = await query(
    "SELECT id, advertiser_id, funded_micros FROM campaigns WHERE id = ? AND stripe_session_id = ?",
    [campaignId, session.id]
  );
  if (rows.length === 0) return false;
  const email = session.customer_email || session.customer_details?.email || null;
  return finalizeCampaign(rows[0].id, rows[0].advertiser_id, rows[0].funded_micros, email);
}
