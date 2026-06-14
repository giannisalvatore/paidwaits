import Router from "@koa/router";
import { query } from "../db.js";
import { verifyWebhook } from "../services/stripe.js";
import { finalizeCampaignBySession } from "../services/funding.js";

// Webhook Stripe (PUBBLICO, fonte di verità per pagamenti e Connect). Il raw body è
// catturato in index.js (ctx.state.rawBody) prima del parsing JSON, per la firma.
export const stripeWebhookRouter = new Router();

stripeWebhookRouter.post("/stripe/webhook", async (ctx) => {
  const event = verifyWebhook(ctx.state.rawBody, ctx.get("stripe-signature"));
  if (!event) ctx.throw(400, "invalid_signature");

  switch (event.type) {
    // Pagamento campagna completato → finalizza (paid=1 + deposito + magic link).
    case "checkout.session.completed": {
      await finalizeCampaignBySession(event.data.object);
      break;
    }
    // Onboarding Connect aggiornato → sincronizza payouts_enabled dell'earner.
    case "account.updated": {
      const account = event.data.object;
      await query("UPDATE users SET payouts_enabled = ? WHERE stripe_account_id = ?", [
        account.payouts_enabled ? 1 : 0,
        account.id,
      ]);
      break;
    }
    default:
      break; // altri eventi ignorati (200 per non far ritentare Stripe)
  }

  ctx.body = { received: true };
});
