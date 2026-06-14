import Koa from "koa";
import helmet from "koa-helmet";
import cors from "@koa/cors";
import session from "koa-session";
import { bodyParser } from "@koa/bodyparser";
import { config } from "./config.js";
import { errorHandler } from "./middleware.js";
import { authRouter } from "./routes/auth.js";
import { sessionRouter } from "./routes/session.js";
import { adsRouter } from "./routes/ads.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { meRouter } from "./routes/me.js";
import { platformRouter } from "./routes/platform.js";
import { checkoutRouter } from "./routes/checkout.js";
import { stripeWebhookRouter } from "./routes/stripe-webhook.js";

const app = new Koa();
app.keys = config.sessionKeys;

app.use(errorHandler);
app.use(helmet());
app.use(
  cors({
    origin: (ctx) => (ctx.get("Origin") === config.frontendOrigin ? config.frontendOrigin : ""),
    credentials: true,
  })
);
app.use(
  session(
    {
      key: "waitingads.sess",
      maxAge: 30 * 86_400_000,
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      signed: true,
    },
    app
  )
);
// Il webhook Stripe richiede il RAW body per la verifica firma: lo bufferizziamo e
// saltiamo il parsing JSON solo per quel path; tutto il resto passa dal bodyParser.
const parseBody = bodyParser({ enableTypes: ["json"], jsonLimit: "100kb" });
app.use(async (ctx, next) => {
  if (ctx.path === "/stripe/webhook" && ctx.method === "POST") {
    ctx.state.rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      ctx.req.on("data", (c) => chunks.push(c));
      ctx.req.on("end", () => resolve(Buffer.concat(chunks)));
      ctx.req.on("error", reject);
    });
    return next();
  }
  return parseBody(ctx, next);
});

app.use(async (ctx, next) => {
  if (ctx.path === "/health") {
    ctx.body = { ok: true };
    return;
  }
  await next();
});

for (const router of [authRouter, sessionRouter, adsRouter, campaignsRouter, meRouter, platformRouter, checkoutRouter, stripeWebhookRouter]) {
  app.use(router.routes());
  app.use(router.allowedMethods());
}

app.listen(config.port, () => {
  console.log(`WaitingAds backend su http://localhost:${config.port}`);
});
