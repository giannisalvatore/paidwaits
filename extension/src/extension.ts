import * as vscode from "vscode";
import * as os from "node:os";
import * as fs from "node:fs";
import { join } from "node:path";
import { Api } from "./api";
import { startLoopback } from "./loopback";
import { discover } from "./adapters/registry";
import { waitingadsDir, writeCliAdCache, cliSessionActive } from "./cliAd";

const HEARTBEAT_MS = 30_000;
const CLISYNC_MS = 15_000;
const CLI_WINDOW_MS = 120_000;      // sessione CLI "attiva" se transcript modificato < 2 min fa
const CLI_IMPRESSION_AT_MS = 6_000; // > MIN_VIEW_MS backend (5s)
const CLI_SLOT_MS = 30_000;         // ruota la creative CLI ogni ~30s

const WEBVIEW_TARGETS = new Set(["claude-code", "codex"]);

interface Creative { adText: string; clickUrl: string; iconUrl: string; adId: string; }

export function activate(context: vscode.ExtensionContext): void {
  const api = new Api(context);
  let sessionId: string | null = null;
  let earnedTodayMicros = 0;
  const home = os.homedir();

  const loopbackPort = vscode.workspace.getConfiguration("waitingads").get("loopbackPort", 48100);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBar);
  statusBar.show();

  function patchedTargets(): string[] {
    return discover()
      .filter((t) => t.adapter.isPatched?.() === true)
      .map((t) => t.id);
  }

  function renderStatusBar(): void {
    if (!api.isConnected) {
      statusBar.text = "$(megaphone) Paidwaits: connetti";
      statusBar.command = "waitingads.connect";
      statusBar.tooltip = "Connetti l'account Paidwaits";
      return;
    }
    statusBar.text = `$(megaphone) $${(earnedTodayMicros / 1_000_000).toFixed(4)} oggi`;
    statusBar.command = "waitingads.status";
    const patched = patchedTargets();
    statusBar.tooltip = patched.length
      ? `Paidwaits attivo su: ${patched.join(", ")}`
      : "Paidwaits connesso — esegui 'Connect account' per attivare";
  }

  async function refreshEarnings(): Promise<void> {
    const me = await api.me();
    if (me) earnedTodayMicros = me.earned_today_micros;
    renderStatusBar();
  }

  async function ensureSession(): Promise<string | null> {
    if (!api.isConnected) return null;
    if (!sessionId) sessionId = await api.startSession(vscode.env.machineId);
    return sessionId;
  }

  // Una creative dall'asta (crea un ad_request lato backend, billabile poi).
  async function currentCreative(): Promise<Creative | null> {
    const session = await ensureSession();
    if (!session) return null;
    const ad = await api.nextAd(session);
    if (!ad || !ad.campaign) return null;
    const name: string = ad.campaign.name || "";
    const creative: string = ad.campaign.creative_text || "";
    return {
      adText: name ? `${name}: ${creative}` : creative,
      clickUrl: ad.campaign.target_url || "",
      iconUrl: ad.campaign.image_url || "",
      adId: ad.ad_request_id || "",
    };
  }

  // Loopback: ponte tra i blocchi webview (claude-code, codex) e il backend.
  const loopback = startLoopback(loopbackPort, {
    api,
    getSession: ensureSession,
    onImpression: () => void refreshEarnings(),
  });
  context.subscriptions.push({ dispose: () => loopback.close() });

  const heartbeatInterval = setInterval(async () => {
    const session = await ensureSession();
    if (session) await api.heartbeat(session);
  }, HEARTBEAT_MS);
  context.subscriptions.push({ dispose: () => clearInterval(heartbeatInterval) });

  // --- CLI sync: tiene fresche le creative delle superfici CLI (statusline +
  // wrapper codex) e fattura le impression CLI lato host (i blocchi webview si
  // auto-fatturano via loopback; le CLI no). ---
  let cliPending: { adId: string; fetchedAt: number; fired: boolean } | null = null;
  function codexCliAdFile(): string { return join(waitingadsDir(home), "codex-cli-ad.txt"); }
  function hasPatchedCliTarget(): boolean {
    return discover().some((t) =>
      (t.id === "claude-cli" || t.id === "codex-cli") && t.adapter.isPatched?.() === true);
  }

  const cliSyncInterval = setInterval(async () => {
    try {
      if (!api.isConnected) return;
      if (!hasPatchedCliTarget()) return;
      const now = Date.now();
      const codexActive = discover().some((t) => t.id === "codex-cli" && t.adapter.isPatched?.());
      const active = codexActive || cliSessionActive(now, CLI_WINDOW_MS);
      if (!active) return;

      // 1) Fattura l'impression in sospeso quando ha "vissuto" abbastanza.
      if (cliPending && !cliPending.fired && now - cliPending.fetchedAt >= CLI_IMPRESSION_AT_MS) {
        cliPending.fired = true;
        const r = await api.impression(cliPending.adId);
        if (r && r.counted) void refreshEarnings();
      }
      // 2) Ruota: nuova creative -> aggiorna le cache CLI.
      if (!cliPending || cliPending.fired || now - cliPending.fetchedAt >= CLI_SLOT_MS) {
        const ad = await currentCreative();
        if (ad) {
          writeCliAdCache(home, ad);                       // statusline (cli-ad.json)
          try {
            fs.mkdirSync(waitingadsDir(home), { recursive: true });
            fs.writeFileSync(codexCliAdFile(), (ad.adText || "WaitingAds") + "\n", "utf8");
          } catch { /* best-effort */ }
          cliPending = { adId: ad.adId, fetchedAt: now, fired: false };
        }
      }
    } catch { /* never throw dal tick */ }
  }, CLISYNC_MS);
  context.subscriptions.push({ dispose: () => clearInterval(cliSyncInterval) });

  // Applica la patch a TUTTI i target presenti. Ritorna il riepilogo per il toast.
  async function applyAll(): Promise<{ patched: string[]; webview: boolean; incompatible: string[] }> {
    const ad = await currentCreative(); // per le superfici CLI (adText/clickUrl iniziali)
    const targets = discover();
    const patched: string[] = [];
    const incompatible: string[] = [];
    let webview = false;
    for (const { id, adapter } of targets) {
      const pf = adapter.preflight();
      if (!pf.compatible) { incompatible.push(id); continue; }
      const r = adapter.applyPatch({
        loopbackPort,
        adText: ad?.adText,
        clickUrl: ad?.clickUrl,
      });
      if (r.ok) {
        patched.push(id);
        if (WEBVIEW_TARGETS.has(id)) webview = true;
      }
    }
    return { patched, webview, incompatible };
  }

  function restoreAll(): string[] {
    const restored: string[] = [];
    for (const { id, adapter } of discover()) {
      const r = adapter.restore();
      if (r.restored) restored.push(id);
    }
    return restored;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("waitingads.connect", async () => {
      const email = await vscode.window.showInputBox({
        prompt: "Email per il login (dev mode — Google OAuth in arrivo)",
        placeHolder: "tu@esempio.com",
      });
      if (!email) return;
      if (!(await api.devLogin(email))) {
        vscode.window.showErrorMessage("Paidwaits: login fallito. Backend attivo?");
        return;
      }
      sessionId = await api.startSession(vscode.env.machineId);
      if (sessionId) await api.heartbeat(sessionId);
      await refreshEarnings();

      const { patched, webview, incompatible } = await applyAll();
      renderStatusBar();
      if (patched.length === 0) {
        vscode.window.showWarningMessage(
          `Paidwaits: nessun target patchato. Trovati incompatibili: ${incompatible.join(", ") || "nessuno"}.`
        );
        return;
      }
      const msg = `Paidwaits attivo su: ${patched.join(", ")}.` +
        (webview ? " Ricarica la finestra perché l'ad appaia sopra lo spinner." : "");
      if (webview) {
        vscode.window.showInformationMessage(msg, "Ricarica ora").then((choice) => {
          if (choice === "Ricarica ora") void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
      } else {
        vscode.window.showInformationMessage(msg);
      }
    }),

    vscode.commands.registerCommand("waitingads.restore", async () => {
      const restored = restoreAll();
      cliPending = null;
      renderStatusBar();
      vscode.window
        .showInformationMessage(
          `Paidwaits: ripristinati ${restored.length ? restored.join(", ") : "nessun target"}. Ricarica la finestra.`,
          "Ricarica ora"
        )
        .then((choice) => {
          if (choice === "Ricarica ora") void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
    }),

    vscode.commands.registerCommand("waitingads.status", async () => {
      const me = await api.me();
      if (!me) {
        vscode.window.showWarningMessage("Paidwaits: non connesso. Usa 'Connect account'.");
        return;
      }
      const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
      const patched = patchedTargets();
      vscode.window.showInformationMessage(
        `Oggi ${usd(me.earned_today_micros)} · Mese ${usd(me.earned_month_micros)} · ` +
        `Saldo ${usd(me.balance_micros)} · ${me.impressions} impression · ` +
        `Target: ${patched.join(", ") || "nessuno"}`
      );
    })
  );

  void refreshEarnings();
}

export function deactivate(): void {}
