"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/api.ts
var vscode = __toESM(require("vscode"));
var Api = class {
  constructor(context) {
    this.context = context;
    this.cookies = context.globalState.get("waitingads.cookies", "");
  }
  cookies;
  get baseUrl() {
    return vscode.workspace.getConfiguration("waitingads").get("apiUrl", "http://localhost:4100");
  }
  get isConnected() {
    return this.cookies.length > 0;
  }
  async request(method, path2, body) {
    const response = await fetch(this.baseUrl + path2, {
      method,
      headers: {
        "content-type": "application/json",
        ...this.cookies ? { cookie: this.cookies } : {}
      },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      this.cookies = setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
      await this.context.globalState.update("waitingads.cookies", this.cookies);
    }
    return response;
  }
  async devLogin(email) {
    const response = await this.request("POST", "/auth/dev", { email });
    return response.ok;
  }
  async me() {
    const response = await this.request("GET", "/me");
    return response.ok ? response.json() : null;
  }
  async startSession(deviceId) {
    const response = await this.request("POST", "/session/start", { device_id: deviceId });
    if (!response.ok) return null;
    const data = await response.json();
    return data.session_id;
  }
  async heartbeat(sessionId) {
    const response = await this.request("POST", "/session/heartbeat", { session_id: sessionId });
    return response.ok ? await response.json() : null;
  }
  async nextAd(sessionId) {
    const response = await this.request("GET", `/ad/next?session_id=${encodeURIComponent(sessionId)}`);
    if (response.status !== 200) return null;
    return response.json();
  }
  async impression(adRequestId) {
    const response = await this.request("POST", "/impression", { ad_request_id: adRequestId });
    return response.ok ? response.json() : null;
  }
  async click(adRequestId) {
    await this.request("POST", "/click", { ad_request_id: adRequestId });
  }
};

// src/loopback.ts
var http = __toESM(require("node:http"));
function cors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}
var AD_ID_RE = /^[0-9a-fA-F-]{8,64}$/;
function startLoopback(port, deps) {
  const server = http.createServer(async (request, response) => {
    cors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    let url;
    try {
      url = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const adId = url.searchParams.get("ad") || "";
    try {
      if (request.method === "GET" && url.pathname === "/ad") {
        const session = await deps.getSession();
        const ad = session ? await deps.api.nextAd(session) : null;
        response.writeHead(200, { "content-type": "application/json" });
        if (!ad || !ad.campaign) {
          response.end("{}");
          return;
        }
        const name = ad.campaign.name || "";
        const creative = ad.campaign.creative_text || "";
        response.end(
          JSON.stringify({
            adText: name ? `${name}: ${creative}` : creative,
            clickUrl: ad.campaign.target_url || "",
            iconUrl: ad.campaign.image_url || "",
            adId: ad.ad_request_id || "",
            campaignId: ""
          })
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/impression") {
        if (AD_ID_RE.test(adId)) {
          const result = await deps.api.impression(adId);
          if (result && result.counted) deps.onImpression();
        }
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/click") {
        if (AD_ID_RE.test(adId)) await deps.api.click(adId);
        response.writeHead(204);
        response.end();
        return;
      }
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

// src/patcher.ts
var fs2 = __toESM(require("node:fs"));

// src/locate.ts
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));
var EXTENSION_ROOTS = [
  ".vscode/extensions",
  ".vscode-insiders/extensions",
  ".vscode-server/extensions",
  ".cursor/extensions",
  ".cursor-server/extensions"
];
function locateClaudeCode() {
  const candidates = [];
  for (const root of EXTENSION_ROOTS) {
    const base = path.join(os.homedir(), root);
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith("anthropic.claude-code-")) continue;
      const dir = path.join(base, entry);
      const webview = path.join(dir, "webview", "index.js");
      const extension = path.join(dir, "extension.js");
      if (fs.existsSync(webview) && fs.existsSync(extension)) {
        candidates.push({ dir, webview, extension });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.dir.localeCompare(a.dir, void 0, { numeric: true }));
  return candidates[0];
}

// src/inject.ts
function buildInjectedScript(port) {
  return `/* PAIDWADS-START */
(function () {
  try {
    var PORT = ${port};
    var BASE = "http://127.0.0.1:" + PORT;
    var GRACE_MS = 1500;          // finestra di freshness del glifo
    var IMPRESSION_AT_MS = 6000;  // 6s di DISPLAY reale prima dell'impression (> 5s backend)
    var REFETCH_MS = 4000;        // backoff del polling /ad quando non c'\xE8 creative
    var EVAL_MS = 80;             // cadenza rilevamento (come kickbacks)

    var overlay = null;                                   // il NOSTRO div, mai dentro CC
    var AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
    var shownAt = 0;              // istante del primo render dell'adId nel turno attivo corrente
    var impressionSent = false;   // impression gi\xE0 contata per l'adId corrente
    var renderedAdId = null;      // adId attualmente nel DOM dell'overlay
    var lastSig = null, lastSigMs = 0;  // tracking freshness (codepoint del primo glifo)
    var fetchingAd = false, lastFetchAt = 0;
    var _rectKey = "";
    var rafPending = false;

    console.log("[paidwaits] injected");

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    // Spinner SOLO via classe: l'ultima riga non vuota \xE8 quella viva (il transcript
    // appende, la riga animata \xE8 sempre l'ultima). READ-ONLY, mai dentro l'editor.
    function findSpinner() {
      try {
        var els = document.querySelectorAll('[class*="spinnerRow_"]');
        var last = null;
        for (var i = 0; i < els.length; i++) {
          if (els[i].nodeType !== 1) continue;
          if ((els[i].textContent || "").trim() !== "") last = els[i];
        }
        return last;
      } catch (e) { return null; }
    }

    // Sfondo opaco a tema: risale gli antenati al primo background non trasparente
    // cos\xEC l'overlay copre davvero il verbo animato di CC senza farlo trasparire.
    function surfaceBg(el) {
      try {
        var n = el, hops = 0;
        while (n && n.nodeType === 1 && hops++ < 10) {
          var bg = (window.getComputedStyle(n) || {}).backgroundColor;
          if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
          n = n.parentElement;
        }
      } catch (e) {}
      return "var(--vscode-editor-background,#1e1e1e)";
    }

    // L'overlay vive su <body>, FUORI dall'albero React di CC (mai mutato).
    function ensureOverlay(row) {
      if (overlay && overlay.parentNode) return overlay;
      overlay = document.createElement("div");
      overlay.id = "paidwaits-overlay";
      overlay.setAttribute("data-paidwaits-overlay", "1");
      overlay.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:auto;display:flex;" +
        "align-items:center;box-sizing:border-box;overflow:hidden;white-space:nowrap;" +
        "visibility:hidden;padding:0 4px;font-size:13px;line-height:1.5;background:" +
        surfaceBg(row);
      try { (document.body || document.documentElement).appendChild(overlay); }
      catch (e) {}
      return overlay;
    }

    // Posiziona SOPRA lo spinner (r.top, non sotto). Scrive lo stile solo quando il
    // rect cambia, per non thrashare il layout durante lo scroll/streaming.
    function placeOverlay(row) {
      try {
        var r = row.getBoundingClientRect();
        if (r && (r.width || r.height || r.top || r.left)) {
          var key = r.left + "," + r.top + "," + r.width + "," + r.height;
          if (key !== _rectKey) {
            _rectKey = key;
            overlay.style.left = r.left + "px";
            overlay.style.top = r.top + "px";
            overlay.style.minWidth = r.width + "px";
            overlay.style.height = r.height + "px";
            overlay.style.visibility = "visible";
          }
        }
      } catch (e) {}
    }

    // Costruisce la creative: vero <a href> (lo apre il host di VS Code, CSP-exempt).
    // Ricostruito SOLO al cambio di adId, mai ogni frame (non staccare l'anchor).
    function renderAd() {
      if (!overlay) return;
      var href = AD.clickUrl ? esc(AD.clickUrl) : "#";
      var icon = AD.iconUrl
        ? '<img src="' + esc(AD.iconUrl) + '" referrerpolicy="no-referrer" ' +
          'style="width:14px;height:14px;margin-right:6px;border-radius:3px;' +
          'vertical-align:middle;flex:0 0 auto" />'
        : "";
      overlay.innerHTML =
        '<span style="opacity:.6;margin-right:6px;flex:0 0 auto">\\u2726 sponsored</span>' +
        icon +
        '<a href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
        'data-paidwaits-ad="1" style="color:var(--vscode-foreground,currentColor);' +
        'text-decoration:underline;overflow:hidden;text-overflow:ellipsis">' +
        esc(AD.adText) + "</a>";
    }

    function adoptAd(d) {
      AD = {
        adText: d.adText || "", clickUrl: d.clickUrl || "", iconUrl: d.iconUrl || "",
        adId: d.adId || "", campaignId: d.campaignId || "",
      };
      renderedAdId = null;   // forza re-render -> shownAt riparte al primo display reale
    }
    function clearAd() {
      AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
      renderedAdId = null;
    }

    // GET /ad: il loopback fa l'asta lato host (crea l'ad_request) e ritorna la
    // creative + l'adId che useremo per impression/click. {} = nessuna campagna.
    function fetchAd() {
      if (fetchingAd) return;
      fetchingAd = true;
      lastFetchAt = Date.now();
      try {
        fetch(BASE + "/ad").then(function (r) { return r.json(); }).then(function (d) {
          fetchingAd = false;
          if (d && d.adText) adoptAd(d); else clearAd();
        }).catch(function () { fetchingAd = false; });
      } catch (e) { fetchingAd = false; }
    }

    function sendImpression() {
      try {
        fetch(BASE + "/impression?ad=" + encodeURIComponent(AD.adId),
          { method: "POST", keepalive: true }).catch(function () {});
      } catch (e) {}
    }

    // Click: l'anchor apre gi\xE0 la landing (CSP-exempt); questo \xE8 SOLO la metrica di
    // billing. Mai preventDefault. Cattura in fase di capture, super-difensivo.
    document.addEventListener("click", function (ev) {
      try {
        var el = ev.target;
        while (el && el !== document) {
          if (el.getAttribute && el.getAttribute("data-paidwaits-ad")) {
            var u = BASE + "/click?ad=" + encodeURIComponent(AD.adId);
            try {
              if (navigator && typeof navigator.sendBeacon === "function") navigator.sendBeacon(u);
              else fetch(u, { method: "POST", keepalive: true }).catch(function () {});
            } catch (e) {}
            return;
          }
          el = el.parentNode;
        }
      } catch (e) {}
    }, true);

    // rAF: tiene l'overlay incollato allo spinner anche durante scroll/streaming.
    function frame() {
      rafPending = false;
      try {
        if (overlay && overlay.style.visibility !== "hidden") {
          var row = findSpinner();
          if (row) placeOverlay(row);
        }
      } catch (e) {}
    }
    function schedule() {
      if (rafPending) return;
      rafPending = true;
      try { window.requestAnimationFrame(frame); } catch (e) { setTimeout(frame, 16); }
    }

    function evaluate() {
      try {
        var now = Date.now();
        var row = findSpinner();
        var active = false;
        if (row) {
          var t = (row.textContent || "").replace(/^[\\s\\u00A0]+/, "");
          var cc = t.charCodeAt(0) | 0;
          if (cc !== lastSig) { lastSig = cc; lastSigMs = now; }  // glifo ciclato => thinking
          active = lastSigMs > 0 && (now - lastSigMs) <= GRACE_MS && t.length > 0;
        } else {
          lastSig = null;  // riga smontata (idle): il prossimo glifo conta come cambio
        }

        if (active) {
          if (!AD.adText) {
            // Nessuna creative: poll /ad con backoff (non a ogni tick).
            if (!fetchingAd && (now - lastFetchAt) >= REFETCH_MS) fetchAd();
          } else {
            ensureOverlay(row);
            if (renderedAdId !== AD.adId) {
              // Nuova creative entra in scena: nuova finestra di display.
              renderAd();
              renderedAdId = AD.adId;
              shownAt = now;
              impressionSent = false;
            }
            placeOverlay(row);
            schedule();
            // Impression: UNA per adId, dopo 6s di DISPLAY reale (now - shownAt), non
            // dall'adozione \u2014 cos\xEC una creative solo prefetchata non viene mai billata
            // senza essere stata davvero a schermo. Poi ruota: slot ~6s, 1 impression
            // ciascuno (un thinking da 15s mostra ~2-3 ad).
            if (!impressionSent && AD.adId && (now - shownAt) >= IMPRESSION_AT_MS) {
              impressionSent = true;
              sendImpression();
              if (!fetchingAd) fetchAd();   // prossimo slot = creative nuova
            }
          }
        } else {
          shownAt = 0;
          if (overlay) { overlay.style.visibility = "hidden"; overlay.innerHTML = ""; renderedAdId = null; }
        }
      } catch (e) {}
    }

    setInterval(evaluate, EVAL_MS);

    // Prefetch all'avvio: scarica una creative (e scalda la sessione lato loopback)
    // PRIMA del primo turno. Senza, il primo "thinking" restava senza ad finch\xE9 la
    // prima /ad non rispondeva \u2014 lenta perch\xE9 crea anche la sessione \u2014 e l'ad
    // sembrava comparire "quando cambia la frase". Retry a vuoto (max 5 \xD7 2s) per
    // coprire l'extension host non ancora pronto al load del webview. Si ferma da
    // s\xE9 appena AD \xE8 popolata.
    var _prefetchTries = 0;
    function prefetch() {
      try {
        if (AD.adText || _prefetchTries >= 5) return;
        _prefetchTries++;
        fetchAd();
        setTimeout(prefetch, 2000);
      } catch (e) {}
    }
    prefetch();
  } catch (e) {}
})();
/* PAIDWADS-END */`;
}
var INJECT_START = "/* PAIDWADS-START */";
var INJECT_END = "/* PAIDWADS-END */";

// src/patcher.ts
var BACKUP_SUFFIX = ".paidwaits-bak";
var SPINNER_SIGNATURE_RE = /spinnerRow_/;
function backupOnce(file) {
  const backup = file + BACKUP_SUFFIX;
  if (!fs2.existsSync(backup)) fs2.copyFileSync(file, backup);
}
function writeAtomic(file, content) {
  const tmp = file + ".paidwaits-tmp";
  fs2.writeFileSync(tmp, content);
  fs2.renameSync(tmp, file);
}
function stripBlock(source) {
  const start = source.indexOf(INJECT_START);
  if (start < 0) return source;
  const end = source.indexOf(INJECT_END, start);
  if (end < 0) return source;
  return source.slice(0, start) + source.slice(end + INJECT_END.length);
}
function patch(port) {
  const install = locateClaudeCode();
  if (!install) return { patched: false, reason: "claude_code_not_found" };
  const webviewSource = fs2.readFileSync(install.webview, "utf8");
  if (!SPINNER_SIGNATURE_RE.test(webviewSource)) {
    return { patched: false, reason: "spinner_signature_not_found" };
  }
  backupOnce(install.webview);
  const clean = stripBlock(webviewSource);
  writeAtomic(install.webview, `${clean}
${buildInjectedScript(port)}
`);
  patchCsp(install, port);
  return { patched: true, version: versionOf(install) };
}
function patchCsp(install, port) {
  const source = fs2.readFileSync(install.extension, "utf8");
  const directive = `connect-src http://127.0.0.1:${port} http://localhost:${port}`;
  if (source.includes(directive)) return;
  backupOnce(install.extension);
  const patched = source.split("default-src 'none'").join(`default-src 'none';${directive}`);
  writeAtomic(install.extension, patched);
}
function restore() {
  const install = locateClaudeCode();
  if (!install) return { patched: false, reason: "claude_code_not_found" };
  for (const file of [install.webview, install.extension]) {
    const backup = file + BACKUP_SUFFIX;
    if (fs2.existsSync(backup)) {
      fs2.copyFileSync(backup, file);
      fs2.rmSync(backup);
    }
  }
  return { patched: false };
}
function isPatched() {
  const install = locateClaudeCode();
  if (!install) return false;
  try {
    return fs2.readFileSync(install.webview, "utf8").includes(INJECT_START);
  } catch {
    return false;
  }
}
function versionOf(install) {
  const match = install.dir.match(/claude-code-([\d.]+)/);
  return match ? match[1] : "?";
}

// src/extension.ts
var HEARTBEAT_MS = 3e4;
function activate(context) {
  const api = new Api(context);
  let sessionId = null;
  let earnedTodayMicros = 0;
  const loopbackPort = vscode2.workspace.getConfiguration("waitingads").get("loopbackPort", 48100);
  const statusBar = vscode2.window.createStatusBarItem(vscode2.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBar);
  statusBar.show();
  function renderStatusBar() {
    if (!api.isConnected) {
      statusBar.text = "$(megaphone) Paidwaits: connetti";
      statusBar.command = "waitingads.connect";
      statusBar.tooltip = "Connetti l'account Paidwaits";
      return;
    }
    statusBar.text = `$(megaphone) $${(earnedTodayMicros / 1e6).toFixed(4)} oggi`;
    statusBar.command = "waitingads.status";
    statusBar.tooltip = isPatched() ? "Paidwaits attivo \u2014 l'ad appare sopra lo spinner di Claude" : "Paidwaits connesso \u2014 esegui 'Connect account' per attivare";
  }
  async function refreshEarnings() {
    const me = await api.me();
    if (me) earnedTodayMicros = me.earned_today_micros;
    renderStatusBar();
  }
  async function ensureSession() {
    if (!api.isConnected) return null;
    if (!sessionId) sessionId = await api.startSession(vscode2.env.machineId);
    return sessionId;
  }
  const loopback = startLoopback(loopbackPort, {
    api,
    getSession: ensureSession,
    onImpression: () => void refreshEarnings()
  });
  context.subscriptions.push({ dispose: () => loopback.close() });
  const heartbeatInterval = setInterval(async () => {
    const session = await ensureSession();
    if (session) await api.heartbeat(session);
  }, HEARTBEAT_MS);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatInterval) });
  async function applyPatchAndPrompt() {
    const result = patch(loopbackPort);
    if (result.patched) {
      vscode2.window.showInformationMessage(
        `Paidwaits attivato su Claude Code ${result.version}. Ricarica la finestra perch\xE9 l'ad appaia sopra lo spinner.`,
        "Ricarica ora"
      ).then((choice) => {
        if (choice === "Ricarica ora") void vscode2.commands.executeCommand("workbench.action.reloadWindow");
      });
    } else if (result.reason === "claude_code_not_found") {
      vscode2.window.showWarningMessage("Paidwaits: estensione Claude Code non trovata. \xC8 installata?");
    } else if (result.reason === "spinner_signature_not_found") {
      vscode2.window.showWarningMessage(
        "Paidwaits: questa versione di Claude Code non \xE8 riconosciuta (firma spinner assente). Serve aggiornare il patcher."
      );
    }
  }
  context.subscriptions.push(
    vscode2.commands.registerCommand("waitingads.connect", async () => {
      const email = await vscode2.window.showInputBox({
        prompt: "Email per il login (dev mode \u2014 Google OAuth in arrivo)",
        placeHolder: "tu@esempio.com"
      });
      if (!email) return;
      if (!await api.devLogin(email)) {
        vscode2.window.showErrorMessage("Paidwaits: login fallito. Backend attivo?");
        return;
      }
      sessionId = await api.startSession(vscode2.env.machineId);
      if (sessionId) await api.heartbeat(sessionId);
      await refreshEarnings();
      await applyPatchAndPrompt();
    }),
    vscode2.commands.registerCommand("waitingads.restore", async () => {
      restore();
      renderStatusBar();
      vscode2.window.showInformationMessage("Paidwaits: file di Claude Code ripristinati. Ricarica la finestra.", "Ricarica ora").then((choice) => {
        if (choice === "Ricarica ora") void vscode2.commands.executeCommand("workbench.action.reloadWindow");
      });
    }),
    vscode2.commands.registerCommand("waitingads.status", async () => {
      const me = await api.me();
      if (!me) {
        vscode2.window.showWarningMessage("Paidwaits: non connesso. Usa 'Connect account'.");
        return;
      }
      const usd = (micros) => `$${(micros / 1e6).toFixed(4)}`;
      vscode2.window.showInformationMessage(
        `Oggi ${usd(me.earned_today_micros)} \xB7 Mese ${usd(me.earned_month_micros)} \xB7 Saldo ${usd(me.balance_micros)} \xB7 ${me.impressions} impression`
      );
    })
  );
  void refreshEarnings();
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
