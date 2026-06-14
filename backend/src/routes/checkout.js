import Router from "@koa/router";
import { query } from "../db.js";
import { config, economics } from "../config.js";
import { rateLimit, requireString, requireNumber, requireHttpsUrl } from "../middleware.js";
import { upsertUser } from "../services/accounts.js";
import { stripeEnabled, createCheckoutSession, retrieveSession } from "../services/stripe.js";
import { finalizeCampaign, finalizeCampaignBySession } from "../services/funding.js";

const MICROS = 1_000_000;

// Router PUBBLICO (niente requireAuth): funnel di acquisizione inserzionisti dalla
// homepage. Crea una campagna draft (paid=0, esclusa dal serving), avvia il pagamento
// Stripe e, a pagamento avvenuto, finalizza + invia il magic link di accesso.
export const checkoutRouter = new Router();
checkoutRouter.use(rateLimit(30));

checkoutRouter.post("/campaigns/checkout", async (ctx) => {
  const body = ctx.request.body || {};
  const email = requireString(ctx, body.email, "email", 255).toLowerCase();
  const name = requireString(ctx, body.name, "name", 100);
  const creativeText = requireString(ctx, body.creative_text, "creative_text", 200);
  const targetUrl = requireHttpsUrl(ctx, body.target_url, "target_url");
  const bidUsd = requireNumber(ctx, body.bid_usd, "bid_usd", { min: economics.MIN_BID_MICROS / MICROS, max: 10_000 });
  const blocks = Math.floor(requireNumber(ctx, body.blocks, "blocks", { min: 1, max: 100_000 }));

  const bidMicros = Math.round(bidUsd * MICROS);
  const fundedMicros = blocks * bidMicros;
  if (fundedMicros < economics.MIN_CAMPAIGN_FUND_MICROS) ctx.throw(400, "below_min_fund");

  const advertiserId = await upsertUser({ email, name: email.split("@")[0] });
  const res = await query(
    "INSERT INTO campaigns (advertiser_id, name, creative_text, image_url, target_url, bid_micros, blocks, funded_micros, status, paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', 0, ?)",
    [advertiserId, name, creativeText, null, targetUrl, bidMicros, blocks, fundedMicros, Date.now()]
  );
  const campaignId = res.insertId;

  // Dev (nessuna chiave Stripe): salta il pagamento, finalizza subito.
  if (!stripeEnabled()) {
    await finalizeCampaign(campaignId, advertiserId, fundedMicros, email);
    ctx.body = { url: `${config.appUrl}/advertiser/success?demo=1`, dev: true };
    return;
  }

  const session = await createCheckoutSession({
    amountMicros: fundedMicros,
    email,
    campaignId,
    successUrl: `${config.appUrl}/advertiser/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${config.appUrl}/#advertisers`,
  });
  await query("UPDATE campaigns SET stripe_session_id = ? WHERE id = ?", [session.id, campaignId]);
  ctx.body = { url: session.url };
});

// Chiamato dalla success page dopo il redirect di Stripe: verifica il pagamento e finalizza.
checkoutRouter.post("/campaigns/checkout/finalize", async (ctx) => {
  if (!stripeEnabled()) {
    ctx.body = { ok: true, dev: true };
    return;
  }
  const sessionId = requireString(ctx, ctx.request.body?.session_id, "session_id", 255);
  const session = await retrieveSession(sessionId);
  if (session.payment_status !== "paid") ctx.throw(402, "payment_incomplete");
  await finalizeCampaignBySession(session);
  ctx.body = { ok: true };
});
