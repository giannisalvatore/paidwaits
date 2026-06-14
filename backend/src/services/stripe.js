import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

// Integrazione Stripe via REST (niente SDK). Checkout Session + finalizzazione su
// redirect, e webhook con verifica firma manuale (HMAC-SHA256).
export const stripeEnabled = () => !!config.stripeSecretKey;

// Verifica la firma di un webhook Stripe (header Stripe-Signature: t=..,v1=..).
// Ritorna l'evento JSON se valido, altrimenti null. Tolleranza default 5 minuti.
export function verifyWebhook(rawBody, sigHeader, toleranceSec = 300) {
  if (!config.stripeWebhookSecret || !sigHeader || !rawBody) return null;
  const parts = Object.fromEntries(
    String(sigHeader)
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return null;
  const signed = `${t}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", config.stripeWebhookSecret).update(signed).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

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

// --- Connect (payout earner) ---------------------------------------------------

// Crea un connected account Express (Stripe ospita KYC + raccolta IBAN).
export async function createConnectAccount(email) {
  return stripePost("accounts", {
    type: "express",
    email,
    "capabilities[transfers][requested]": "true",
  });
}

// Link di onboarding hosted (KYC + conto). type=account_onboarding.
export async function createAccountLink(accountId, refreshUrl, returnUrl) {
  return stripePost("account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
}

export async function retrieveAccount(accountId) {
  const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  });
  if (!res.ok) throw new Error(`stripe_error_${res.status}`);
  return res.json();
}

// Transfer dal saldo piattaforma → connected account dell'earner.
export async function createTransfer({ amountMicros, destinationAccountId, metadata = {} }) {
  const cents = Math.round(amountMicros / 10_000); // micros → cent
  const params = {
    amount: String(cents),
    currency: "usd",
    destination: destinationAccountId,
  };
  for (const [k, v] of Object.entries(metadata)) params[`metadata[${k}]`] = String(v);
  return stripePost("transfers", params);
}
