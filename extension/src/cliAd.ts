import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";

// Cartella e file condivisi tra l'estensione e gli script CLI (statusline, wrapper).
export function waitingadsDir(home = homedir()): string {
  return join(home, ".waitingads");
}
export function cliAdPath(home = homedir()): string {
  return join(waitingadsDir(home), "cli-ad.json");
}

export interface CliAd {
  adText: string; clickUrl: string; iconUrl: string; adId: string; ts: number;
}

// Terminal esc()-analog: rimuove SOLO i caratteri di controllo (C0+DEL+C1) così i
// campi non possono iniettare sequenze ANSI/OSC nel terminale. Emoji/url passano.
export function stripControlChars(s: string): string {
  return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export function writeCliAdCache(
  home: string,
  ad: { adText: string; clickUrl: string; iconUrl: string; adId: string },
): void {
  const dir = waitingadsDir(home);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rec: CliAd = {
    adText: stripControlChars(ad.adText),
    clickUrl: stripControlChars(ad.clickUrl),
    iconUrl: stripControlChars(ad.iconUrl),
    adId: stripControlChars(ad.adId),
    ts: Date.now(),
  };
  writeFileSync(cliAdPath(home), JSON.stringify(rec), "utf8");
}

// Evidenza che una sessione `claude` CLI sia plausibilmente viva: un transcript
// ~/.claude/projects/**/*.jsonl modificato entro windowMs. Versione semplificata
// (non parsiamo i tag entrypoint). Never throws.
export function cliSessionActive(
  now: number, windowMs: number, root = join(homedir(), ".claude", "projects"),
): boolean {
  try {
    if (!existsSync(root)) return false;
    for (const proj of readdirSync(root)) {
      let entries: string[];
      try { entries = readdirSync(join(root, proj)); } catch { continue; }
      for (const f of entries) {
        if (!f.endsWith(".jsonl")) continue;
        try {
          const m = statSync(join(root, proj, f)).mtimeMs;
          if (m > 0 && (now - m) <= windowMs) return true;
        } catch { /* ignore */ }
      }
    }
    return false;
  } catch { return false; }
}
