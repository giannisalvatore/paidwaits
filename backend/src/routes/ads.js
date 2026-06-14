import Router from "@koa/router";
import { randomUUID } from "node:crypto";
import { query, scalar, transaction } from "../db.js";
import { economics, guard } from "../config.js";
import { requireAuth, requireString } from "../middleware.js";
import { ownedSession, isEarning } from "../services/guard.js";
import { pickCampaign, campaignSpend } from "../services/auction.js";
import { recordSpend, earnedSince } from "../services/ledger.js";
import { getKillState, claimBillingEvent, isValidEventUuid, impressionCooldownOk } from "../services/serving.js";

export const adsRouter = new Router();
adsRouter.use(requireAuth);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Verbi per lo spinner di Claude Code (settings.json → spinnerVerbs).
// Restituisce le creative delle campagne eleggibili, ordinate per bid (le più
// alte appaiono più spesso se Claude pesca a caso). È la via supportata per
// mostrare gli ad sullo spinner senza patchare il bundle.
adsRouter.get("/spinner-verbs", async (ctx) => {
  const campaigns = await query(
    "SELECT id, name, creative_text, bid_micros, funded_micros, status FROM campaigns WHERE status = 'live' ORDER BY bid_micros DESC"
  );
  const verbs = [];
  for (const campaign of campaigns) {
    const costMicros = Math.floor(campaign.bid_micros / 1000);
    if (campaign.funded_micros - (await campaignSpend(campaign.id)) < costMicros) continue;
    verbs.push(`${campaign.name}: ${campaign.creative_text}`);
    if (verbs.length >= 20) break;
  }
  ctx.body = { verbs };
});

// L'estensione chiede un'ad a inizio thinking. L'asta sceglie la campagna.
adsRouter.get("/ad/next", async (ctx) => {
  // Serving gate: killswitch globale (env o platform_flags). Killed => nessun ad
  // (l'overlay del webview sparisce entro un poll; nessun ad_request creato).
  const kill = await getKillState();
  if (kill.killed) {
    ctx.status = 204;
    return;
  }
  const sessionId = requireString(ctx, ctx.query.session_id, "session_id", 36);
  const session = await ownedSession(ctx.state.userId, sessionId);
  if (!session) ctx.throw(404, "session_not_found");
  if (Date.now() - session.last_heartbeat > guard.HEARTBEAT_TTL_MS) ctx.throw(409, "session_expired");

  // Layer 1: Valida che il thinking sia attivo (POST /thinking-start è stato chiamato, non finito, non scaduto).
  const now = Date.now();
  const thinking = await scalar(
    "SELECT expires_at FROM thinking_sessions WHERE user_id = ? AND session_id = ? AND finished_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    [ctx.state.userId, sessionId, now]
  );
  if (!thinking) ctx.throw(409, "no_active_thinking");

  const campaign = await pickCampaign(ctx.state.userId);
  if (!campaign) {
    ctx.status = 204;
    return;
  }

  const adRequestId = randomUUID();
  const earning = session.earning === 1;
  await query(
    "INSERT INTO ad_requests (id, user_id, session_id, campaign_id, earning, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    [adRequestId, ctx.state.userId, sessionId, campaign.id, earning ? 1 : 0, Date.now()]
  );

  ctx.body = {
    ad_request_id: adRequestId,
    earning,
    campaign: {
      name: campaign.name,
      creative_text: campaign.creative_text,
      image_url: campaign.image_url,
      target_url: campaign.target_url,
    },
  };
});

async function loadPendingAdRequest(ctx) {
  const adRequestId = requireString(ctx, ctx.request.body?.ad_request_id, "ad_request_id", 36);
  const rows = await query(
    "SELECT id, user_id, session_id, campaign_id, earning, status, created_at FROM ad_requests WHERE id = ? AND user_id = ?",
    [adRequestId, ctx.state.userId]
  );
  if (rows.length === 0) ctx.throw(404, "ad_request_not_found");
  return rows[0];
}

// Conta solo le impression pagate (quelle che hanno generato un guadagno).
function paidImpressionsSince(userId, sinceMs) {
  return scalar("SELECT COUNT(*) FROM impressions WHERE user_id = ? AND created_at >= ?", [userId, sinceMs]);
}

// Validazione impression (ANALISI.md §4): sessione earning viva, >=5s, cap orari/giornalieri.
adsRouter.post("/impression", async (ctx) => {
  const adRequest = await loadPendingAdRequest(ctx);
  const now = Date.now();
  const eventUuid = ctx.request.body?.event_uuid;
  if (eventUuid !== undefined && !isValidEventUuid(eventUuid)) ctx.throw(400, "invalid_event_uuid");

  const reject = async (reason) => {
    await query("UPDATE ad_requests SET status = 'expired' WHERE id = ? AND status = 'pending'", [adRequest.id]);
    ctx.body = { counted: false, reason };
  };

  if (adRequest.status !== "pending") return reject("already_used");

  // Layer 1: Valida che il thinking sia ANCORA attivo (non finito, non scaduto)
  const thinking = await scalar(
    "SELECT expires_at FROM thinking_sessions WHERE user_id = ? AND session_id = ? AND finished_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    [ctx.state.userId, adRequest.session_id, now]
  );
  if (!thinking) return reject("thinking_expired");

  if (now - adRequest.created_at < guard.MIN_VIEW_MS) return reject("too_fast");
  if (now - adRequest.created_at > guard.AD_REQUEST_TTL_MS) return reject("expired");
  if (adRequest.earning !== 1) return reject("not_earning_session");
  if (!(await isEarning(ctx.state.userId, adRequest.session_id))) return reject("not_earning_session");

  // Cooldown anti-burst: NON scade l'ad_request (è un throttle transitorio).
  if (!(await impressionCooldownOk(ctx.state.userId, now))) {
    ctx.body = { counted: false, reason: "cooldown" };
    return;
  }

  if ((await paidImpressionsSince(ctx.state.userId, now - HOUR_MS)) >= guard.IMP_HOUR_CAP) return reject("hour_cap");
  if ((await paidImpressionsSince(ctx.state.userId, now - DAY_MS)) >= guard.IMP_DAY_CAP) return reject("day_cap");
  if ((await earnedSince(ctx.state.userId, now - DAY_MS)) >= guard.EARN_DAY_CAP_MICROS) return reject("earn_cap");

  const campaigns = await query(
    "SELECT id, advertiser_id, bid_micros, funded_micros, status FROM campaigns WHERE id = ?",
    [adRequest.campaign_id]
  );
  const campaign = campaigns[0];
  const costMicros = Math.floor(campaign.bid_micros / 1000);
  if (campaign.status !== "live") return reject("campaign_paused");
  if (campaign.funded_micros - (await campaignSpend(campaign.id)) < costMicros) return reject("campaign_budget");

  const earned = await transaction(async (connection) => {
    // Idempotenza: se questo event_uuid è già stato registrato è un replay → non rifatturare.
    if (eventUuid && !(await claimBillingEvent(connection, {
      eventUuid, kind: "impression", userId: ctx.state.userId, refId: adRequest.id,
    }))) {
      return "DUP";
    }
    const [updated] = await connection.query(
      "UPDATE ad_requests SET status = 'converted' WHERE id = ? AND status = 'pending'",
      [adRequest.id]
    );
    if (updated.affectedRows === 0) return null; // doppio submit in parallelo
    const userShare = Math.floor(costMicros * economics.USER_SHARE);
    const [impRes] = await connection.query(
      "INSERT INTO impressions (ad_request_id, campaign_id, user_id, session_id, cost_micros, user_share_micros, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [adRequest.id, campaign.id, ctx.state.userId, adRequest.session_id, costMicros, userShare, now]
    );
    // Layer 3: Crea impression_status con status 'pending' (7gg maturazione)
    await connection.query(
      "INSERT INTO impression_status (impression_id, status, updated_at) VALUES (?, 'pending', ?)",
      [impRes.insertId, now]
    );
    return recordSpend(connection, {
      refType: "impression",
      refId: adRequest.id,
      advertiserId: campaign.advertiser_id,
      userId: ctx.state.userId,
      costMicros,
    });
  });

  if (earned === "DUP") {
    ctx.body = { counted: false, reason: "duplicate" };
    return;
  }
  if (earned === null) return reject("already_used");
  ctx.body = { counted: true, earned_micros: earned };
});

// Click: l'inserzionista paga bid × CLICK_MULT / 1000, l'utente NON guadagna nulla
// (zero incentivo al click fraud). Cap giornaliero e dedupe per campagna proteggono l'inserzionista.
adsRouter.post("/click", async (ctx) => {
  const adRequest = await loadPendingAdRequest(ctx);
  const now = Date.now();
  const eventUuid = ctx.request.body?.event_uuid;
  if (eventUuid !== undefined && !isValidEventUuid(eventUuid)) ctx.throw(400, "invalid_event_uuid");

  const impressions = await query(
    "SELECT id, campaign_id FROM impressions WHERE ad_request_id = ? AND user_id = ?",
    [adRequest.id, ctx.state.userId]
  );
  if (impressions.length === 0) ctx.throw(409, "impression_required");
  const impression = impressions[0];

  const existing = await scalar("SELECT COUNT(*) FROM clicks WHERE impression_id = ?", [impression.id]);
  if (existing > 0) {
    ctx.body = { counted: false, reason: "already_clicked" };
    return;
  }

  const campaigns = await query(
    "SELECT id, advertiser_id, bid_micros, funded_micros, status FROM campaigns WHERE id = ?",
    [impression.campaign_id]
  );
  const campaign = campaigns[0];
  const clickCostMicros = Math.floor((campaign.bid_micros * economics.CLICK_MULT) / 1000);

  const paidToday = await scalar(
    "SELECT COUNT(*) FROM clicks WHERE user_id = ? AND cost_micros > 0 AND created_at >= ?",
    [ctx.state.userId, now - DAY_MS]
  );
  const paidSameCampaign = await scalar(
    "SELECT COUNT(*) FROM clicks WHERE user_id = ? AND campaign_id = ? AND cost_micros > 0",
    [ctx.state.userId, campaign.id]
  );
  const paid =
    campaign.status === "live" &&
    paidToday < guard.CLICK_DAY_CAP &&
    paidSameCampaign === 0 &&
    campaign.funded_micros - (await campaignSpend(campaign.id)) >= clickCostMicros;

  let dup = false;
  await transaction(async (connection) => {
    // Idempotenza: replay dello stesso event_uuid → non re-inserire il click.
    if (eventUuid && !(await claimBillingEvent(connection, {
      eventUuid, kind: "click", userId: ctx.state.userId, refId: String(impression.id),
    }))) {
      dup = true;
      return;
    }
    const cost = paid ? clickCostMicros : 0;
    await connection.query(
      "INSERT INTO clicks (impression_id, campaign_id, user_id, cost_micros, user_share_micros, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      [impression.id, campaign.id, ctx.state.userId, cost, now]
    );
    if (!paid) return;
    await recordSpend(connection, {
      refType: "click",
      refId: String(impression.id),
      advertiserId: campaign.advertiser_id,
      userId: ctx.state.userId,
      costMicros: cost,
    });
  });

  if (dup) {
    ctx.body = { counted: false, reason: "duplicate" };
    return;
  }
  ctx.body = { counted: true, paid };
});
