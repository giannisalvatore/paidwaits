// Script iniettato DENTRO il webview di Claude Code (gira con la sua CSP).
//
// Approccio (copiato da kickbacks.ai, adattato a CC 2.1.175 e al nostro backend):
//   • Rileva lo spinner "thinking" via la classe `spinnerRow_*` (NON un verbo: in
//     CC il glifo animato e il verbo sono in <span> separati, e scansionare tutto
//     il documento per parole-verbo colpirebbe l'editor/markdown — prime directive).
//   • Liveness = FRESHNESS: lo spinner è "vivo" se il primo glifo cambia entro
//     GRACE_MS (CC cicla 6 glifi ogni 120ms). Niente codepoint hardcoded → robusto
//     anche se CC cambia i glifi tra le versioni.
//   • Render = overlay a livello <body>, posizionato in SOLA LETTURA sopra il rect
//     dello spinner (getBoundingClientRect + requestAnimationFrame). NON tocchiamo
//     MAI l'albero React di CC: mutarlo farebbe smontare lo spinner alla prossima
//     reconciliation. Sfondo opaco a tema così copre il verbo sotto.
//   • L'ad è un vero <a href> verso l'inserzionista: è l'UNICO click-out che
//     sopravvive alla CSP `default-src 'none'` (lo apre il host di VS Code).
//   • La creative arriva live dal loopback (`GET /ad`); impression/click sono
//     pingati al loopback con l'adId, che lato host fa l'asta/billing reali.
// Tutto in try/catch: non deve MAI far crashare Claude Code. Logga su [paidwaits].
export function buildInjectedScript(port: number): string {
  return `/* PAIDWADS-START */
(function () {
  try {
    var PORT = ${port};
    var BASE = "http://127.0.0.1:" + PORT;
    var GRACE_MS = 1500;          // finestra di freshness del glifo
    var IMPRESSION_AT_MS = 6000;  // 6s di DISPLAY reale prima dell'impression (> 5s backend)
    var REFETCH_MS = 4000;        // backoff del polling /ad quando non c'è creative
    var EVAL_MS = 80;             // cadenza rilevamento (come kickbacks)

    var overlay = null;                                   // il NOSTRO div, mai dentro CC
    var AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
    var shownAt = 0;              // istante del primo render dell'adId nel turno attivo corrente
    var impressionSent = false;   // impression già contata per l'adId corrente
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

    // Spinner SOLO via classe: l'ultima riga non vuota è quella viva (il transcript
    // appende, la riga animata è sempre l'ultima). READ-ONLY, mai dentro l'editor.
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
    // così l'overlay copre davvero il verbo animato di CC senza farlo trasparire.
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

    // Click: l'anchor apre già la landing (CSP-exempt); questo è SOLO la metrica di
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
            // dall'adozione — così una creative solo prefetchata non viene mai billata
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
    // PRIMA del primo turno. Senza, il primo "thinking" restava senza ad finché la
    // prima /ad non rispondeva — lenta perché crea anche la sessione — e l'ad
    // sembrava comparire "quando cambia la frase". Retry a vuoto (max 5 × 2s) per
    // coprire l'extension host non ancora pronto al load del webview. Si ferma da
    // sé appena AD è popolata.
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

export const INJECT_START = "/* PAIDWADS-START */";
export const INJECT_END = "/* PAIDWADS-END */";
