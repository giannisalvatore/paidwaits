// Script statusline scritto in ~/.waitingads/ ed eseguito da Claude Code CLI a
// ogni refresh della status line (configurato come `statusLine` in settings.json).
// Stampa la riga sponsorizzata (link OSC 8 cliccabile) leggendo la cache cli-ad.json
// che l'estensione tiene aggiornata. Se l'utente aveva già una propria statusLine
// (chain-capture), la esegue e ne impila l'output SOTTO l'ad. Never throws; un hard
// deadline limita il comando incatenato così una HUD bloccata non appende mai CC.
export const STATUSLINE_SCRIPT_NAME = "waitingads-statusline.mjs";
const FRESH_MS = 10 * 60 * 1000;
const CHAIN_TIMEOUT_MS = 5000;

export function buildStatuslineScript(cachePath: string, prevPath: string): string {
  return `// WAITINGADS statusline — generato automaticamente. Non modificare a mano.
import { readFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";

let wrote = false;
const put = (s) => { try { writeSync(1, s); wrote = true; } catch {} };
try {
  const CACHE = ${JSON.stringify(cachePath)};
  const FRESH_MS = ${FRESH_MS};
  const o = JSON.parse(readFileSync(CACHE, "utf8"));
  const fresh = o && typeof o.ts === "number" && (Date.now() - o.ts) <= FRESH_MS
    && typeof o.adText === "string" && o.adText.length > 0;
  if (fresh) {
    const strip = (s) => String(s).replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, "");
    const text = "ad· " + strip(o.adText);
    const url = typeof o.clickUrl === "string" ? strip(o.clickUrl) : "";
    const ESC = "\\u001b";
    put(url
      ? ESC + "]8;;" + url + ESC + "\\\\" + text + ESC + "]8;;" + ESC + "\\\\"
      : text);
  }
} catch {}
try {
  const PREV = ${JSON.stringify(prevPath)};
  const sl = JSON.parse(readFileSync(PREV, "utf8")).statusLine;
  const cmd = sl && sl.type === "command" && typeof sl.command === "string" ? sl.command : "";
  if (cmd && !cmd.includes(${JSON.stringify(STATUSLINE_SCRIPT_NAME)})) {
    const stdinMode = process.stdin.isTTY ? "ignore" : "inherit";
    const CHAIN_TIMEOUT_MS = ${CHAIN_TIMEOUT_MS};
    const DRAIN_MS = 150;
    const child = spawn(cmd, { shell: true, windowsHide: true, stdio: [stdinMode, "pipe", "ignore"] });
    let out = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const text = out.replace(/[\\r\\n]+$/, "");
      if (text) put((wrote ? "\\n" : "") + text);
      process.exit(0);
    };
    child.stdout.on("data", (d) => { out += d; });
    child.stdout.on("error", () => {});
    child.on("error", finish);
    child.on("close", finish);
    child.on("exit", () => { setTimeout(finish, DRAIN_MS); });
    setTimeout(() => { try { child.kill(); } catch {} finish(); }, CHAIN_TIMEOUT_MS);
  } else {
    process.exit(0);
  }
} catch { process.exit(0); }
`;
}
