// Blocco iniettato come PRIMA istruzione dell'entry ThinkingShimmer di Codex:
//   function v(e){ e=(<QUESTO IIFE>)||e; ... }
// L'IIFE ritorna SEMPRE undefined → `e = undefined || e` → il componente di Codex
// gira intatto. Non mutiamo MAI il suo albero React: leggiamo la riga "thinking"
// READ-ONLY e dipingiamo l'ad in un nostro overlay su <body>. Creative live da /ad.
// NB: Codex non è installato su questa macchina → non verificato (inerte finché
// l'estensione Codex non c'è: il locator ritorna null e discover() lo esclude).
export function buildCodexBlock(port: number): string {
  return `(function () {
  "use strict";
  try {
    if (window.__waitingadsCodexBoot) return undefined;
    window.__waitingadsCodexBoot = 1;
  } catch (e) { return undefined; }
  try {
    var PORT = ${port};
    var BASE = "http://127.0.0.1:" + PORT;
    var GRACE_MS = 1500;
    var IMPRESSION_AT_MS = 6000;
    var REFETCH_MS = 4000;

    var AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
    var overlay = null, lastRow = null, lastSeenMs = 0, _rect = "";
    var shownAt = 0, impressionSent = false, renderedAdId = null;
    var fetchingAd = false, lastFetchAt = 0;

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    // Riga thinking-shimmer di Codex (read-only): combo di classi stabile
    // text-size-chat + truncate + select-none + loading-shimmer, rect non-zero,
    // visibile. Richiediamo tutti i token così nient'altro nella chat fa match.
    function findRow() {
      try {
        var els = document.querySelectorAll('[class*="text-size-chat"][class*="truncate"]');
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el.nodeType !== 1) continue;
          var c = " " + (el.className || "") + " ";
          if (c.indexOf("select-none") === -1) continue;
          if (c.indexOf("loading-shimmer") === -1) continue;
          var r = el.getBoundingClientRect && el.getBoundingClientRect();
          if (!r || (!r.width && !r.height)) continue;
          try {
            var cs = window.getComputedStyle && window.getComputedStyle(el);
            if (cs) {
              if (cs.visibility === "hidden" || cs.display === "none") continue;
              if (parseFloat(cs.opacity || "1") < 0.05) continue;
            }
          } catch (e) {}
          return el;
        }
      } catch (e) {}
      return null;
    }
    // Mostra SOLO sul placeholder generico "Thinking" (mai su tool/approval reali).
    function isThinkingRow(el) {
      if (!el) return false;
      var t = (el.textContent || "").trim().toLowerCase();
      return t.length > 0 && t.length <= 32 && t.indexOf("thinking") === 0;
    }
    function surfaceBg(el) {
      try {
        var n = el, hops = 0;
        while (n && n.nodeType === 1 && hops++ < 20) {
          var cs = window.getComputedStyle(n) || {};
          var ov = cs.overflowY || cs.overflow;
          if (ov === "auto" || ov === "scroll") {
            var bg = cs.backgroundColor;
            if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
            break;
          }
          n = n.parentElement;
        }
        var bodyBg = (window.getComputedStyle(document.body) || {}).backgroundColor;
        if (bodyBg && bodyBg !== "transparent" && bodyBg !== "rgba(0, 0, 0, 0)") return bodyBg;
      } catch (e) {}
      return "var(--vscode-sideBar-background,var(--vscode-editor-background,#1e1e1e))";
    }

    function ensureOverlay(row) {
      if (overlay && overlay.parentNode) return overlay;
      overlay = document.createElement("div");
      overlay.setAttribute("data-paidwaits-overlay", "codex");
      overlay.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:auto;display:flex;" +
        "align-items:center;box-sizing:border-box;overflow:hidden;white-space:nowrap;" +
        "visibility:hidden;padding:0 4px;font-size:13px;background:" + surfaceBg(row);
      try { (document.body || document.documentElement).appendChild(overlay); } catch (e) {}
      return overlay;
    }
    function placeOverlay(row) {
      try {
        var r = row.getBoundingClientRect();
        if (r && (r.width || r.height || r.top || r.left)) {
          var key = r.left + "," + r.top + "," + r.width + "," + r.height;
          if (key !== _rect) {
            _rect = key;
            overlay.style.left = r.left + "px";
            overlay.style.top = r.top + "px";
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
      overlay.innerHTML =
        '<span style="opacity:.6;margin-right:6px;flex:0 0 auto">\\u2726 sponsored</span>' +
        '<a href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
        'data-paidwaits-ad="1" style="color:var(--vscode-foreground,currentColor);' +
        'text-decoration:underline;overflow:hidden;text-overflow:ellipsis">' +
        esc(AD.adText) + "</a>";
    }
    function dropOverlay() {
      try { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) {}
      overlay = null; lastRow = null; _rect = ""; shownAt = 0; impressionSent = false; renderedAdId = null;
    }

    function adoptAd(d) {
      AD = { adText: d.adText || "", clickUrl: d.clickUrl || "", iconUrl: d.iconUrl || "",
             adId: d.adId || "", campaignId: d.campaignId || "" };
      renderedAdId = null;
    }
    function clearAd() {
      AD = { adText: "", clickUrl: "", iconUrl: "", adId: "", campaignId: "" };
      renderedAdId = null;
    }
    function fetchAd() {
      if (fetchingAd) return;
      fetchingAd = true; lastFetchAt = Date.now();
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
            return;
          }
          el = el.parentNode;
        }
      } catch (e) {}
    }, true);

    function frame() {
      try { if (overlay && lastRow && lastRow.isConnected) placeOverlay(lastRow); } catch (e) {}
      try { window.requestAnimationFrame(frame); } catch (e) { setTimeout(frame, 16); }
    }
    try { window.requestAnimationFrame(frame); } catch (e) { setTimeout(frame, 16); }

    setInterval(function () {
      try {
        var now = Date.now();
        var row = findRow();
        if (row && isThinkingRow(row)) {
          lastRow = row; lastSeenMs = now;
          if (!AD.adText) {
            if (!fetchingAd && (now - lastFetchAt) >= REFETCH_MS) fetchAd();
          } else {
            ensureOverlay(row);
            if (renderedAdId !== AD.adId) { renderAd(); renderedAdId = AD.adId; shownAt = now; impressionSent = false; }
            placeOverlay(row);
            if (!impressionSent && AD.adId && (now - shownAt) >= IMPRESSION_AT_MS) {
              impressionSent = true; sendImpression();
              if (!fetchingAd) fetchAd();
            }
          }
        } else if (overlay && (now - lastSeenMs) > GRACE_MS) {
          dropOverlay();
        }
      } catch (e) {}
    }, 80);

    var _tries = 0;
    function prefetch() {
      try {
        if (AD.adText || _tries >= 5) return;
        _tries++; fetchAd(); setTimeout(prefetch, 2000);
      } catch (e) {}
    }
    prefetch();
  } catch (e) {}
  return undefined;
})()`;
}
