import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ClaudeInstall = {
  dir: string; // cartella dell'estensione Claude Code
  webview: string; // webview/index.js
  extension: string; // extension.js
};

// Cartelle in cui VS Code / Cursor installano le estensioni.
const EXTENSION_ROOTS = [
  ".vscode/extensions",
  ".vscode-insiders/extensions",
  ".vscode-server/extensions",
  ".cursor/extensions",
  ".cursor-server/extensions",
];

// Trova l'installazione di Claude Code più recente (versione più alta).
export function locateClaudeCode(): ClaudeInstall | null {
  const candidates: ClaudeInstall[] = [];
  for (const root of EXTENSION_ROOTS) {
    const base = path.join(os.homedir(), root);
    let entries: string[];
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
  // Ordine per nome cartella: la versione semver più alta vince (sort lessicografico va bene a parità di padding).
  candidates.sort((a, b) => b.dir.localeCompare(a.dir, undefined, { numeric: true }));
  return candidates[0];
}
