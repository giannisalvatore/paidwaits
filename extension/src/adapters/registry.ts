import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import type { TargetAdapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code/adapter";
import { ClaudeCliAdapter } from "./claude-cli/adapter";
import { CodexAdapter } from "./codex/adapter";
import { CodexCliAdapter } from "./codex-cli/adapter";

const HOME = homedir();
const IS_WIN = platform() === "win32";

// Root dove VS Code / Cursor (locale e server) installano le estensioni.
const EXT_ROOTS = [
  ".vscode", ".vscode-insiders", ".vscode-server", ".vscode-server-insiders",
  ".cursor", ".cursor-server",
].map((d) => join(HOME, d, "extensions"));

// Il più recente `<root>/<prefix>*/<...sub>` tra tutti i root (ordine lessicografico
// numerico: la versione più alta vince). Never throws.
function newestUnder(prefix: string, sub: string[]): string | null {
  const hits: string[] = [];
  for (const root of EXT_ROOTS) {
    try {
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root)) {
        if (!name.startsWith(prefix)) continue;
        const p = join(root, name, ...sub);
        if (existsSync(p)) hits.push(p);
      }
    } catch { /* ignora questo root */ }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return hits[hits.length - 1];
}

// Codex spedisce l'entry in un chunk content-hashed:
// openai.chatgpt-<ver>/webview/assets/thinking-shimmer-<hash>.js
function newestCodexChunk(): string | null {
  for (const root of EXT_ROOTS) {
    try {
      if (!existsSync(root)) continue;
      const ext = readdirSync(root).filter((n) => n.startsWith("openai.chatgpt-")).sort();
      for (let i = ext.length - 1; i >= 0; i--) {
        const assets = join(root, ext[i], "webview", "assets");
        if (!existsSync(assets)) continue;
        const cf = readdirSync(assets).filter((n) => /^thinking-shimmer-.*\.js$/.test(n)).sort();
        if (cf.length) return join(assets, cf[0]);
      }
    } catch { /* ignora */ }
  }
  return null;
}

// Cerca un eseguibile per nome nelle dir del PATH + alcune posizioni comuni.
function findOnPath(...names: string[]): string | null {
  const dirs = (process.env.PATH || "").split(IS_WIN ? ";" : ":").filter(Boolean);
  const extra = [join(HOME, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin",
                 join(HOME, ".npm-global", "bin"), join(HOME, "node_modules", ".bin")];
  for (const dir of [...dirs, ...extra]) {
    for (const name of names) {
      try { const p = join(dir, name); if (existsSync(p)) return p; } catch { /* ignora */ }
    }
  }
  return null;
}

// ~/.claude/settings.json — sempre il path; lo includiamo solo se Claude CLI è
// plausibilmente in uso (binario `claude` nel PATH o cartella ~/.claude presente).
function locateClaudeCliSettings(): string | null {
  const claudeDir = join(HOME, ".claude");
  const usable = existsSync(claudeDir) || findOnPath(IS_WIN ? "claude.cmd" : "claude", "claude") !== null;
  return usable ? join(claudeDir, "settings.json") : null;
}

function locateCodexShim(): string | null {
  return findOnPath(IS_WIN ? "codex.cmd" : "codex", "codex");
}

export interface DiscoveredTarget { id: string; adapter: TargetAdapter; }

// Ogni target presente su questa macchina, in ordine di precedenza. Un locator
// rotto non blocca mai gli altri (ognuno è guardato). claude-code è il primario.
export function discover(): DiscoveredTarget[] {
  const out: DiscoveredTarget[] = [];
  const add = (id: string, locate: () => string | null, make: (t: string) => TargetAdapter): void => {
    try {
      const t = locate();
      if (t) out.push({ id, adapter: make(t) });
    } catch { /* un locator rotto non blocca gli altri */ }
  };
  add("claude-code", () => newestUnder("anthropic.claude-code-", ["webview", "index.js"]),
    (t) => new ClaudeCodeAdapter(t));
  add("claude-cli", locateClaudeCliSettings, (t) => new ClaudeCliAdapter(t));
  add("codex", newestCodexChunk, (t) => new CodexAdapter(t));
  add("codex-cli", locateCodexShim, (t) => new CodexCliAdapter(t, HOME));
  return out;
}
