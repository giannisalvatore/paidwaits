import { query, scalar } from "../db.js";
import { auction } from "../config.js";

// Modello a BLOCK (stile kickbacks):
// - i BLOCK comprano VOLUME: 1 block = 1.000 views (da 5s) GARANTITE da consegnare.
//   Una campagna è in coda finché non ha consegnato blocks × 1.000 views.
// - il BID è il prezzo per block E la POSIZIONE IN CODA: bid più alto = consegna
//   prima (servito per primo), NON più views. (Le views le comprano i block.)
// - anti-ripetizione per utente: una campagna mostrata a QUESTO utente negli ultimi
//   REPEAT_COOLDOWN_MS è spinta in fondo, così non la rivede due volte di fila;
//   resta in coda per bid tra le altre. Non cambia il volume totale garantito.
export async function pickCampaign(userId) {
  const campaigns = await query(
    "SELECT id, advertiser_id, name, creative_text, image_url, target_url, bid_micros, blocks, funded_micros FROM campaigns WHERE status = 'live' AND paid = 1"
  );

  const eligible = [];
  for (const campaign of campaigns) {
    const costMicros = Math.floor(campaign.bid_micros / 1000);
    const spent = await campaignSpend(campaign.id);
    if (campaign.funded_micros - spent < costMicros) continue;          // budget di sicurezza
    const delivered = await scalar("SELECT COUNT(*) FROM impressions WHERE campaign_id = ?", [campaign.id]);
    if (delivered >= campaign.blocks * auction.VIEWS_PER_BLOCK) continue; // block esauriti
    eligible.push(campaign);
  }
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  // Quali campagne sono state servite a questo utente di recente (anti-ripetizione).
  const recent = new Set();
  if (userId) {
    const ids = eligible.map((c) => c.id);
    const since = Date.now() - auction.REPEAT_COOLDOWN_MS;
    const rows = await query(
      "SELECT DISTINCT campaign_id FROM ad_requests WHERE user_id = ? AND campaign_id IN (?) AND created_at >= ?",
      [userId, ids, since]
    );
    for (const r of rows) recent.add(Number(r.campaign_id));
  }

  // Preferisci le non-recenti; tra il pool scelto vince il bid più alto (rank in coda).
  const fresh = eligible.filter((c) => !recent.has(c.id));
  const pool = fresh.length ? fresh : eligible;
  pool.sort((a, b) => b.bid_micros - a.bid_micros);
  return pool[0];
}

// Spesa totale di una campagna (impression + click) dal ledger della campagna.
export async function campaignSpend(campaignId) {
  const impressionSpend = await scalar(
    "SELECT COALESCE(SUM(cost_micros), 0) FROM impressions WHERE campaign_id = ?",
    [campaignId]
  );
  const clickSpend = await scalar("SELECT COALESCE(SUM(cost_micros), 0) FROM clicks WHERE campaign_id = ?", [
    campaignId,
  ]);
  return impressionSpend + clickSpend;
}
