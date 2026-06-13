import * as vscode from "vscode";
import * as os from "node:os";
import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Api } from "./api";
import { startLoopback } from "./loopback";
import { discover } from "./adapters/registry";
import { waitingadsDir, writeCliAdCache, cliSessionActive } from "./cliAd";

const HEARTBEAT_MS = 30_000;
const CLISYNC_MS = 15_000;
const MAINTENANCE_MS = 60_000;       // poll killswitch + reassert drift
const CLI_WINDOW_MS = 120_000;       // sessione CLI "attiva" se transcript modificato < 2 min fa
const CLI_IMPRESSION_AT_MS = 6_000;  // > MIN_VIEW_MS backend (5s)
const CLI_SLOT_MS = 30_000;          // ruota la creative CLI ogni ~30s
const ACTIVE_KEY = "waitingads.active"; // intento utente: "ads accese" (persistito)

const WEBVIEW_TARGETS = new Set(["claude-code", "codex"]);

type KillPosture = "clear" | "confirmed" | "offline";

interface Creative { adText: string; clickUrl: string; iconUrl: string; adId: string; }

export function activate(context: vscode.ExtensionContext): void {
  const api = new Api(context);
  let sessionId: string | null = null;
  let earnedTodayMicros = 0;
  let killPosture: KillPosture = "clear";
  const home = os.homedir();
  const loopbackPort = vscode.workspace.getConfiguration("waitingads").get("loopbackPort", 48100);
  const output = vscode.window.createOutputChannel("WaitingAds");
  context.subscriptions.push(output);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBar);
  statusBar.show();

  const isActiveIntent = (): boolean => context.globalState.get(ACTIVE_KEY, false);
  const setActiveIntent = (v: boolean): Thenable<void> => context.globalState.update(ACTIVE_KEY, v);

  function primaryVersion(): string {
    const cc = discover().find((t) => t.id === "claude-code");
    return cc?.adapter.version() || "unknown";
  }
  function patchedTargets(): string[] {
    return discover().filter((t) => t.adapter.isPatched?.() === true).map((t) => t.id);
  }

  function renderStatusBar(): void {
    if (!api.isConnected) {
      statusBar.text = "$(megaphone) Paidwaits: connetti";
      statusBar.command = "waitingads.connect";
      statusBar.tooltip = "Connetti l'account Paidwaits";
      return;
    }
    statusBar.command = "waitingads.status";
    if (killPosture === "confirmed") {
      statusBar.text = "$(megaphone) Paidwaits: sospeso";
      statusBar.tooltip = "Serving sospeso dal killswitch lato server";
      return;
    }
    statusBar.text = `$(megaphone) $${(earnedTodayMicros / 1_000_000).toFixed(4)} oggi`;
    const patched = patchedTargets();
    const offline = killPosture === "offline" ? " · offline" : "";
    statusBar.tooltip = (patched.length
      ? `Paidwaits attivo su: ${patched.join(", ")}`
      : "Paidwaits connesso — esegui 'Connect account' per attivare") + offline;
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

  // --- CLI sync: creative fresche per le superfici CLI + billing impression CLI. ---
  let cliPending: { adId: string; fetchedAt: number; fired: boolean } | null = null;
  const codexCliAdFile = (): string => join(waitingadsDir(home), "codex-cli-ad.txt");
  const hasPatchedCliTarget = (): boolean =>
    discover().some((t) => (t.id === "claude-cli" || t.id === "codex-cli") && t.adapter.isPatched?.() === true);

  const cliSyncInterval = setInterval(async () => {
    try {
      if (!api.isConnected || killPosture === "confirmed") return;
      if (!hasPatchedCliTarget()) return;
      const now = Date.now();
      const codexActive = discover().some((t) => t.id === "codex-cli" && t.adapter.isPatched?.());
      if (!(codexActive || cliSessionActive(now, CLI_WINDOW_MS))) return;

      if (cliPending && !cliPending.fired && now - cliPending.fetchedAt >= CLI_IMPRESSION_AT_MS) {
        cliPending.fired = true;
        const r = await api.impression(cliPending.adId, randomUUID());
        if (r && r.counted) void refreshEarnings();
      }
      if (!cliPending || cliPending.fired || now - cliPending.fetchedAt >= CLI_SLOT_MS) {
        const ad = await currentCreative();
        if (ad) {
          writeCliAdCache(home, ad);
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

  async function applyAll(): Promise<{ patched: string[]; webview: boolean; incompatible: string[] }> {
    const ad = await currentCreative();
    const patched: string[] = [];
    const incompatible: string[] = [];
    let webview = false;
    for (const { id, adapter } of discover()) {
      const pf = adapter.preflight();
      if (!pf.compatible) { incompatible.push(id); continue; }
      const r = adapter.applyPatch({ loopbackPort, adText: ad?.adText, clickUrl: ad?.clickUrl });
      if (r.ok) {
        patched.push(id);
        if (WEBVIEW_TARGETS.has(id)) webview = true;
      } else {
        void api.telemetry("patch_failed", pf.version || "unknown", `${id}: ${r.reason || "?"}`);
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
    cliPending = null;
    return restored;
  }

  // --- Maintenance: poll killswitch (postura) + reassert drift (CC aggiornato). ---
  async function maintenanceTick(): Promise<void> {
    if (!api.isConnected || !isActiveIntent()) return;
    const kill = await api.killswitch();
    killPosture = kill === null ? "offline" : kill.killed ? "confirmed" : "clear";
    renderStatusBar();

    if (killPosture === "confirmed") {
      // Kill confermato: smonta tutto (il server già non serve; qui togliamo i file).
      // L'intento resta: quando il kill rientra, il reassert ri-applica.
      if (patchedTargets().length > 0) {
        const restored = restoreAll();
        void api.telemetry("killed", primaryVersion(), `${kill?.reason || ""} restored=${restored.join(",")}`);
      }
      return;
    }
    if (killPosture === "offline") return; // freeze: né restore né nuove scritture

    // clear: reassert. Se un target era patchato e ora non lo è più (CC aggiornato/
    // sovrascritto), ri-applica così l'ad non sparisce in silenzio.
    let creative: Creative | null = null;
    const reasserted: string[] = [];
    for (const { id, adapter } of discover()) {
      if (adapter.isPatched?.() === true) continue;
      const pf = adapter.preflight();
      if (!pf.compatible) continue;
      if (creative === null) creative = await currentCreative();
      const r = adapter.applyPatch({ loopbackPort, adText: creative?.adText, clickUrl: creative?.clickUrl });
      if (r.ok) reasserted.push(id);
    }
    if (reasserted.length) void api.telemetry("reassert", primaryVersion(), reasserted.join(","));
  }
  const maintInterval = setInterval(() => void maintenanceTick(), MAINTENANCE_MS);
  context.subscriptions.push({ dispose: () => clearInterval(maintInterval) });

  function diagnoseReport(): string {
    const lines = [
      `WaitingAds — diagnose`,
      `connesso: ${api.isConnected} · intento attivo: ${isActiveIntent()} · kill: ${killPosture}`,
      `loopback: 127.0.0.1:${loopbackPort}`,
      ``,
    ];
    for (const { id, adapter } of discover()) {
      const pf = adapter.preflight();
      lines.push(
        `[${id}] version=${pf.version} compatible=${pf.compatible} ` +
        `patched=${adapter.isPatched?.() ?? "n/a"}${pf.reason ? ` reason="${pf.reason}"` : ""}`
      );
    }
    if (lines.length === 4) lines.push("(nessun target trovato su questa macchina)");
    return lines.join("\n");
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
      await setActiveIntent(patched.length > 0);
      renderStatusBar();
      void api.telemetry("connect", primaryVersion(), `patched=${patched.join(",")} incompat=${incompatible.join(",")}`);

      if (patched.length === 0) {
        vscode.window.showWarningMessage(
          `Paidwaits: nessun target patchato. Incompatibili: ${incompatible.join(", ") || "nessuno"}.`
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
      await setActiveIntent(false);
      renderStatusBar();
      void api.telemetry("restore", primaryVersion(), restored.join(","));
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
      vscode.window.showInformationMessage(
        `Oggi ${usd(me.earned_today_micros)} · Mese ${usd(me.earned_month_micros)} · ` +
        `Saldo ${usd(me.balance_micros)} · ${me.impressions} impression · ` +
        `Target: ${patchedTargets().join(", ") || "nessuno"}`
      );
    }),

    vscode.commands.registerCommand("waitingads.diagnose", async () => {
      const report = diagnoseReport();
      output.clear();
      output.appendLine(report);
      output.show(true);
      void api.telemetry("diagnose", primaryVersion(), patchedTargets().join(","));
    })
  );

  void refreshEarnings();
  void api.telemetry("activate", primaryVersion(), isActiveIntent() ? "active" : "idle");
  // Reassert all'avvio: se CC si è aggiornato e ha cancellato la patch, ri-applicala.
  if (isActiveIntent()) void maintenanceTick();
}

export function deactivate(): void {}
