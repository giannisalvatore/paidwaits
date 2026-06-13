import Router from "@koa/router";
import { randomUUID } from "node:crypto";
import { query, scalar } from "../db.js";
import { economics } from "../config.js";
import { requireAuth, requireString, requireNumber, requireHttpsUrl } from "../middleware.js";
import { campaignSpend } from "../services/auction.js";

export const campaignsRouter = new Router();
campaignsRouter.use(requireAuth);

const MICROS = 1_000_000;
const DAY_MS = 86_400_000;

async function ownedCampaign(ctx) {
  const campaignId = requireNumber(ctx, ctx.params.id, "campaign_id", { min: 1 });
  const rows = await query(
    "SELECT id, advertiser_id, name, creative_text, image_url, target_url, bid_micros, funded_micros, status FROM campaigns WHERE id = ? AND advertiser_id = ?",
    [campaignId, ctx.state.userId]
  );
  if (rows.length === 0) ctx.throw(404, "campaign_not_found");
  return rows[0];
}

// Le proprie campagne, con statistiche e budget residuo.
campaignsRouter.get("/campaigns", async (ctx) => {
  const campaigns = await query(
    "SELECT id, name, creative_text, image_url, target_url, bid_micros, funded_micros, status, created_at FROM campaigns WHERE advertiser_id = ? ORDER BY created_at DESC",
    [ctx.state.userId]
  );
  const result = [];
  for (const campaign of campaigns) {
    const impressions = await scalar("SELECT COUNT(*) FROM impressions WHERE campaign_id = ?", [campaign.id]);
    const clicks = await scalar("SELECT COUNT(*) FROM clicks WHERE campaign_id = ?", [campaign.id]);
    const spent = await campaignSpend(campaign.id);
    result.push({
      id: campaign.id,
      name: campaign.name,
      creative_text: campaign.creative_text,
      image_url: campaign.image_url,
      target_url: campaign.target_url,
      bid_micros: campaign.bid_micros,
      funded_micros: campaign.funded_micros,
      remaining_micros: campaign.funded_micros - spent,
      status: campaign.status,
      impressions,
      clicks,
      spent_micros: spent,
      created_at: campaign.created_at,
    });
  }
  ctx.body = { campaigns: result };
});

// Crea e finanzia la campagna in un colpo solo. Il budget E il pagamento (bottone "Lancia").
// MVP: il fondo viene accreditato direttamente. TODO produzione: Stripe Checkout + webhook,
// la campagna diventa 'live' SOLO alla conferma del pagamento.
campaignsRouter.post("/campaigns", async (ctx) => {
  const body = ctx.request.body || {};
  const name = requireString(ctx, body.name, "name", 100);
  const creativeText = requireString(ctx, body.creative_text, "creative_text", 200);
  const targetUrl = requireHttpsUrl(ctx, body.target_url, "target_url");
  const imageUrl = body.image_url ? requireHttpsUrl(ctx, body.image_url, "image_url") : null;
  const bidUsd = requireNumber(ctx, body.bid_usd, "bid_usd", { min: economics.MIN_BID_MICROS / MICROS, max: 10_000 });
  const budgetUsd = requireNumber(ctx, body.budget_usd, "budget_usd", {
    min: economics.MIN_CAMPAIGN_FUND_MICROS / MICROS,
    max: 100_000,
  });

  const result = await query(
    "INSERT INTO campaigns (advertiser_id, name, creative_text, image_url, target_url, bid_micros, funded_micros, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?)",
    [
      ctx.state.userId,
      name,
      creativeText,
      imageUrl,
      targetUrl,
      Math.round(bidUsd * MICROS),
      Math.round(budgetUsd * MICROS),
      Date.now(),
    ]
  );
  // Registra il pagamento del budget (audit trail).
  await query(
    "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('advertiser', ?, ?, 'deposit', ?, ?)",
    [ctx.state.userId, Math.round(budgetUsd * MICROS), `campaign:${result.insertId}`, Date.now()]
  );
  ctx.status = 201;
  ctx.body = { id: result.insertId };
});

// Aggiunge budget a una campagna esistente (top-up = pagamento).
campaignsRouter.post("/campaigns/:id/fund", async (ctx) => {
  const campaign = await ownedCampaign(ctx);
  const amountUsd = requireNumber(ctx, ctx.request.body?.amount_usd, "amount_usd", {
    min: economics.MIN_CAMPAIGN_FUND_MICROS / MICROS,
    max: 100_000,
  });
  const amountMicros = Math.round(amountUsd * MICROS);
  await query("UPDATE campaigns SET funded_micros = funded_micros + ? WHERE id = ? AND advertiser_id = ?", [
    amountMicros,
    campaign.id,
    ctx.state.userId,
  ]);
  await query(
    "INSERT INTO ledger (account_type, account_id, amount_micros, ref_type, ref_id, created_at) VALUES ('advertiser', ?, ?, 'deposit', ?, ?)",
    [ctx.state.userId, amountMicros, `campaign:${campaign.id}`, Date.now()]
  );
  ctx.body = { funded_micros: campaign.funded_micros + amountMicros };
});

// L'unica leva di delivery e il bid: modificabile live. Ownership check su tutto.
campaignsRouter.patch("/campaigns/:id", async (ctx) => {
  const campaign = await ownedCampaign(ctx);
  const body = ctx.request.body || {};

  const updates = { ...campaign };
  if (body.name !== undefined) updates.name = requireString(ctx, body.name, "name", 100);
  if (body.creative_text !== undefined) updates.creative_text = requireString(ctx, body.creative_text, "creative_text", 200);
  if (body.target_url !== undefined) updates.target_url = requireHttpsUrl(ctx, body.target_url, "target_url");
  if (body.image_url !== undefined) {
    updates.image_url = body.image_url === null ? null : requireHttpsUrl(ctx, body.image_url, "image_url");
  }
  if (body.bid_usd !== undefined) {
    const bidUsd = requireNumber(ctx, body.bid_usd, "bid_usd", { min: economics.MIN_BID_MICROS / MICROS, max: 10_000 });
    updates.bid_micros = Math.round(bidUsd * MICROS);
  }
  if (body.status !== undefined) {
    if (body.status !== "live" && body.status !== "paused") ctx.throw(400, "invalid_status");
    updates.status = body.status;
  }

  await query(
    "UPDATE campaigns SET name = ?, creative_text = ?, image_url = ?, target_url = ?, bid_micros = ?, status = ? WHERE id = ? AND advertiser_id = ?",
    [
      updates.name,
      updates.creative_text,
      updates.image_url,
      updates.target_url,
      updates.bid_micros,
      updates.status,
      campaign.id,
      ctx.state.userId,
    ]
  );
  ctx.body = { ok: true };
});

// Riepilogo per la dashboard: contatori, totali e serie giornaliera (ultimi 14 giorni)
// per i grafici. Solo dati dell'inserzionista autenticato.
campaignsRouter.get("/campaigns/summary", async (ctx) => {
  const userId = ctx.state.userId;
  const now = Date.now();
  const since = now - 14 * DAY_MS;

  const totalCampaigns = await scalar("SELECT COUNT(*) FROM campaigns WHERE advertiser_id = ?", [userId]);
  const totalImpressions = await scalar(
    "SELECT COUNT(*) FROM impressions WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?)",
    [userId]
  );
  const totalClicks = await scalar(
    "SELECT COUNT(*) FROM clicks WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?)",
    [userId]
  );
  const impSpend = await scalar(
    "SELECT COALESCE(SUM(cost_micros), 0) FROM impressions WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?)",
    [userId]
  );
  const clickSpend = await scalar(
    "SELECT COALESCE(SUM(cost_micros), 0) FROM clicks WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?)",
    [userId]
  );

  // Conta come "serving" le campagne live con budget residuo.
  const live = await query(
    "SELECT id, funded_micros FROM campaigns WHERE advertiser_id = ? AND status = 'live'",
    [userId]
  );
  let serving = 0;
  for (const campaign of live) {
    if (campaign.funded_micros - (await campaignSpend(campaign.id)) >= 1) serving += 1;
  }

  // Serie giornaliera: bucket lato app (niente alias SQL).
  const impRows = await query(
    "SELECT created_at, cost_micros FROM impressions WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?) AND created_at >= ?",
    [userId, since]
  );
  const clickRows = await query(
    "SELECT created_at FROM clicks WHERE campaign_id IN (SELECT id FROM campaigns WHERE advertiser_id = ?) AND created_at >= ?",
    [userId, since]
  );

  const days = [];
  const dayMs = DAY_MS;
  const startOfToday = Math.floor(now / dayMs) * dayMs;
  const index = new Map();
  for (let i = 13; i >= 0; i -= 1) {
    const dayStart = startOfToday - i * dayMs;
    const entry = { day: dayStart, impressions: 0, clicks: 0, spend_micros: 0 };
    days.push(entry);
    index.set(dayStart, entry);
  }
  const bucket = (timestamp) => index.get(Math.floor(timestamp / dayMs) * dayMs);
  for (const row of impRows) {
    const entry = bucket(Number(row.created_at));
    if (entry) {
      entry.impressions += 1;
      entry.spend_micros += Number(row.cost_micros);
    }
  }
  for (const row of clickRows) {
    const entry = bucket(Number(row.created_at));
    if (entry) entry.clicks += 1;
  }

  ctx.body = {
    campaigns: totalCampaigns,
    serving,
    impressions: totalImpressions,
    clicks: totalClicks,
    spend_micros: impSpend + clickSpend,
    ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    series: days,
  };
});
