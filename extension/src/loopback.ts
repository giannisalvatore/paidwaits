import * as http from "node:http";
import type { Api } from "./api";

// Server locale: ponte autenticato tra lo script iniettato nel webview (che non ha
// le credenziali) e il backend. Il webview chiede la creative con `GET /ad` (qui
// facciamo l'asta reale lato host e creiamo l'ad_request), poi pinga impression/click
// riferendosi all'adId restituito — così billiamo ESATTAMENTE l'ad mostrato (niente
// più race tra ciò che il webview mostra e ciò che il backend addebita).
export type LoopbackDeps = {
  api: Api;
  getSession: () => Promise<string | null>;
  onImpression: () => void;
};

function cors(response: http.ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}

// L'adId è l'ad_request_id (UUID) restituito da /ad: lo accettiamo solo se plausibile.
const AD_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export function startLoopback(port: number, deps: LoopbackDeps): http.Server {
  const server = http.createServer(async (request, response) => {
    cors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const adId = url.searchParams.get("ad") || "";

    try {
      // GET /ad — asta lato host: crea l'ad_request e ritorna la creative.
      // {} = nessuna campagna eleggibile (no-serve): il webview nasconde l'overlay.
      if (request.method === "GET" && url.pathname === "/ad") {
        const session = await deps.getSession();
        const ad = session ? await deps.api.nextAd(session) : null;
        response.writeHead(200, { "content-type": "application/json" });
        if (!ad || !ad.campaign) {
          response.end("{}");
          return;
        }
        const name: string = ad.campaign.name || "";
        const creative: string = ad.campaign.creative_text || "";
        response.end(
          JSON.stringify({
            adText: name ? `${name}: ${creative}` : creative,
            clickUrl: ad.campaign.target_url || "",
            iconUrl: ad.campaign.image_url || "",
            adId: ad.ad_request_id || "",
            campaignId: "",
          })
        );
        return;
      }

      // POST /impression?ad=<ad_request_id> — il backend valida (>=5s, sessione
      // earning, cap) e accredita; solo se contata aggiorniamo i guadagni.
      if (request.method === "POST" && url.pathname === "/impression") {
        if (AD_ID_RE.test(adId)) {
          const result = await deps.api.impression(adId);
          if (result && result.counted) deps.onImpression();
        }
        response.writeHead(204);
        response.end();
        return;
      }

      // POST /click?ad=<ad_request_id> — la landing l'ha già aperta l'<a href> nel
      // webview; qui registriamo solo il click (il backend richiede l'impression).
      if (request.method === "POST" && url.pathname === "/click") {
        if (AD_ID_RE.test(adId)) await deps.api.click(adId);
        response.writeHead(204);
        response.end();
        return;
      }

      // /ping di diagnostica: conferma che il loopback è raggiungibile dal webview.
      if (request.method === "GET" && url.pathname === "/ping") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.writeHead(404);
      response.end();
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
