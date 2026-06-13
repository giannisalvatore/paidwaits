import { query, scalar } from "../db.js";

// Asta continua per-impression (ANALISI.md §5):
// - eleggibili: campagne live con budget residuo (funded - spesa) sufficiente
// - estrazione pesata sul bid: P(i) = bid_i / somma dei bid eleggibili
// - prezzo first-price: l'inserzionista paga sempre il proprio bid / 1000 per impression
export async function pickCampaign() {
  const campaigns = await query(
    "SELECT id, advertiser_id, name, creative_text, image_url, target_url, bid_micros, funded_micros FROM campaigns WHERE status = 'live'"
  );

  const eligible = [];
  for (const campaign of campaigns) {
    const costMicros = Math.floor(campaign.bid_micros / 1000);
    const spent = await campaignSpend(campaign.id);
    if (campaign.funded_micros - spent < costMicros) continue;
    eligible.push(campaign);
  }
  if (eligible.length === 0) return null;

  const totalBid = eligible.reduce((sum, campaign) => sum + campaign.bid_micros, 0);
  let draw = Math.random() * totalBid;
  for (const campaign of eligible) {
    draw -= campaign.bid_micros;
    if (draw <= 0) return campaign;
  }
  return eligible[eligible.length - 1];
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
