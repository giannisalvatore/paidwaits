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
app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "100kb" }));

app.use(async (ctx, next) => {
  if (ctx.path === "/health") {
    ctx.body = { ok: true };
    return;
  }
  await next();
});

for (const router of [authRouter, sessionRouter, adsRouter, campaignsRouter, meRouter]) {
  app.use(router.routes());
  app.use(router.allowedMethods());
}

app.listen(config.port, () => {
  console.log(`WaitingAds backend su http://localhost:${config.port}`);
});
