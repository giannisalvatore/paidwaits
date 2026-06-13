// Script iniettato DENTRO il webview di Claude Code (gira con la sua CSP).
// Vedi il commento storico in cima all'adapter. In breve: rileva lo spinner via
// la classe `spinnerRow_*` (read-only), liveness via FRESHNESS del glifo, overlay
// a livello <body> sopra il rect dello spinner (mai mutiamo l'albero React di CC),
// ad come vero <a href> (unico click-out che sopravvive alla CSP), creative live
// dal loopback (GET /ad). Tutto in try/catch: non deve MAI far crashare CC.
export function buildClaudeCodeBlock(port: number): string {
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

    console.log("[paidwaits] injected (claude-code)");

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

    function placeOverlay(row) {
      try {
        var r = row.getBoundingClientRect();
        if (r && (r.width || r.height || r.top || r.left)) {
          var key = r.left + "," + r.top + "," + r.width + "," + r.height;
          if (key !== _rectKey) {
            _rectKey = key;
            overlay.style.left = r.left + "px";
            overlay.style.top = r.top + "px";        // r.top -> SOPRA lo spinner
            overlay.style.minWidth = r.width + "px";
            overlay.style.height = r.height + "px";
            overlay.style.visibility = "visible";
          }
        }
      } catch (e) {}
    }

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
      renderedAdId = null;
    }
    function clearAd() {
      AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
      renderedAdId = null;
    }
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
            return;          // mai preventDefault: lascia aprire l'href
          }
          el = el.parentNode;
        }
      } catch (e) {}
    }, true);

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
          if (cc !== lastSig) { lastSig = cc; lastSigMs = now; }
          active = lastSigMs > 0 && (now - lastSigMs) <= GRACE_MS && t.length > 0;
        } else {
          lastSig = null;
        }

        if (active) {
          if (!AD.adText) {
            if (!fetchingAd && (now - lastFetchAt) >= REFETCH_MS) fetchAd();
          } else {
            ensureOverlay(row);
            if (renderedAdId !== AD.adId) {
              renderAd(); renderedAdId = AD.adId; shownAt = now; impressionSent = false;
            }
            placeOverlay(row);
            schedule();
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

    // Prefetch all'avvio: creative pronta (e sessione scaldata) prima del primo
    // turno, così il primo "thinking" mostra subito l'ad. Retry a vuoto (max 5×2s).
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

export const BLOCK_START = "/* PAIDWADS-START */";
export const BLOCK_END = "/* PAIDWADS-END */";
