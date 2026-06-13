import * as vscode from "vscode";
import { Api } from "./api";
import { startLoopback } from "./loopback";
import { patch, restore as restoreBundle, isPatched } from "./patcher";

const HEARTBEAT_MS = 30_000;

export function activate(context: vscode.ExtensionContext): void {
  const api = new Api(context);
  let sessionId: string | null = null;
  let earnedTodayMicros = 0;

  const loopbackPort = vscode.workspace.getConfiguration("waitingads").get("loopbackPort", 48100);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBar);
  statusBar.show();

  function renderStatusBar(): void {
    if (!api.isConnected) {
      statusBar.text = "$(megaphone) Paidwaits: connetti";
      statusBar.command = "waitingads.connect";
      statusBar.tooltip = "Connetti l'account Paidwaits";
      return;
    }
    statusBar.text = `$(megaphone) $${(earnedTodayMicros / 1_000_000).toFixed(4)} oggi`;
    statusBar.command = "waitingads.status";
    statusBar.tooltip = isPatched()
      ? "Paidwaits attivo — l'ad appare sopra lo spinner di Claude"
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

  // Loopback: ponte autenticato tra lo script iniettato nel webview e il backend.
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

  async function applyPatchAndPrompt(): Promise<void> {
    // La creative arriva live dal loopback (GET /ad): niente più embed al patch-time.
    // Se non ci sono campagne attive, il webview semplicemente non mostra l'overlay.
    const result = patch(loopbackPort);
    if (result.patched) {
      vscode.window
        .showInformationMessage(
          `Paidwaits attivato su Claude Code ${result.version}. Ricarica la finestra perché l'ad appaia sopra lo spinner.`,
          "Ricarica ora"
        )
        .then((choice) => {
          if (choice === "Ricarica ora") void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
    } else if (result.reason === "claude_code_not_found") {
      vscode.window.showWarningMessage("Paidwaits: estensione Claude Code non trovata. È installata?");
    } else if (result.reason === "spinner_signature_not_found") {
      vscode.window.showWarningMessage(
        "Paidwaits: questa versione di Claude Code non è riconosciuta (firma spinner assente). Serve aggiornare il patcher."
      );
    }
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
      await applyPatchAndPrompt(); // login + patch del webview automatici
    }),

    vscode.commands.registerCommand("waitingads.restore", async () => {
      restoreBundle();
      renderStatusBar();
      vscode.window
        .showInformationMessage("Paidwaits: file di Claude Code ripristinati. Ricarica la finestra.", "Ricarica ora")
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
        `Oggi ${usd(me.earned_today_micros)} · Mese ${usd(me.earned_month_micros)} · Saldo ${usd(me.balance_micros)} · ${me.impressions} impression`
      );
    })
  );

  void refreshEarnings();
}

export function deactivate(): void {}
