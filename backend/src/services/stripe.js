import { config } from "../config.js";

// Integrazione Stripe via REST (niente SDK, niente webhook raw-body): creiamo la
// Checkout Session e finalizziamo sul redirect di successo verificando payment_status.
export const stripeEnabled = () => !!config.stripeSecretKey;

async function stripePost(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`stripe_error_${res.status}:${detail.slice(0, 200)}`);
  }
  return res.json();
}

export async function createCheckoutSession({ amountMicros, email, campaignId, successUrl, cancelUrl }) {
  const cents = Math.round(amountMicros / 10_000); // 1.000.000 micros = $1 = 100 cent
  return stripePost("checkout/sessions", {
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": `WaitingAds campaign #${campaignId}`,
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][quantity]": "1",
    customer_email: email,
    "metadata[campaign_id]": String(campaignId),
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function retrieveSession(id) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  });
  if (!res.ok) throw new Error(`stripe_error_${res.status}`);
  return res.json();
}
