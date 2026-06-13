import { query, scalar } from "../db.js";
import { auction } from "../config.js";

// Asta continua per-impression. Obiettivo: il bid compra VOLUME (incentivo a
// pagare di più), senza mostrare la stessa creativa due volte di fila allo stesso
// utente.
// - eleggibili: campagne live con budget residuo sufficiente.
// - lotteria pesata: peso = bid^BID_EXPONENT × fattore_recency(utente). La quota
//   di impression scala col bid → per avere più volume devi rilanciare (e col
//   first-price paghi il tuo bid pieno su OGNI impression).
// - fattore_recency: una campagna appena servita a questo utente è declassata
//   finché non passa REPEAT_COOLDOWN_MS (recupero lineare), con un minimo residuo
//   REPEAT_MIN_FACTOR → niente due viste consecutive, ma il top-bidder torna a
//   dominare appena "ricaricato".
// - first-price: l'inserzionista paga sempre bid / 1000 per impression.
function weightedPick(weighted) {
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return weighted[weighted.length - 1].campaign;
  let draw = Math.random() * total;
  for (const w of weighted) {
    draw -= w.weight;
    if (draw <= 0) return w.campaign;
  }
  return weighted[weighted.length - 1].campaign;
}

export async function pickCampaign(userId) {
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
  if (eligible.length === 1) return eligible[0];

  // Recency per utente: ultima volta che ogni campagna eleggibile gli è stata servita.
  const lastByCampaign = new Map();
  if (userId) {
    const ids = eligible.map((c) => c.id);
    const rows = await query(
      "SELECT campaign_id, MAX(created_at) AS last_at FROM ad_requests WHERE user_id = ? AND campaign_id IN (?) GROUP BY campaign_id",
      [userId, ids]
    );
    for (const r of rows) lastByCampaign.set(Number(r.campaign_id), Number(r.last_at));
  }

  const now = Date.now();
  const weighted = eligible.map((campaign) => {
    const last = lastByCampaign.get(campaign.id);
    const gap = last ? now - last : Infinity;
    // 0 appena vista → 1 dopo il cooldown (recupero lineare), con minimo residuo.
    const recency = gap >= auction.REPEAT_COOLDOWN_MS
      ? 1
      : Math.max(auction.REPEAT_MIN_FACTOR, gap / auction.REPEAT_COOLDOWN_MS);
    const base = Math.pow(campaign.bid_micros, auction.BID_EXPONENT);
    return { campaign, weight: base * recency };
  });

  return weightedPick(weighted);
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
