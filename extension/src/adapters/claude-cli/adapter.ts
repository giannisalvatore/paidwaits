import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams } from "../types";
import { parseable, readTopLevel, upsertStatusLine, upsertSpinnerVerbs, removeTopLevel } from "./settingsEdit";
import { buildStatuslineScript, STATUSLINE_SCRIPT_NAME } from "./statusline";
import { waitingadsDir, cliAdPath, writeCliAdCache } from "../../cliAd";

const ABSENT = " WAITINGADS-ABSENT";
const PREV_NAME = "cli-prev-statusline.json";

function isForeignStatusLine(v: unknown): v is { type: string; command: string } {
  return typeof v === "object" && v !== null
    && (v as { type?: unknown }).type === "command"
    && typeof (v as { command?: unknown }).command === "string"
    && !(v as { command: string }).command.includes(STATUSLINE_SCRIPT_NAME);
}

// Scrive in ~/.claude/settings.json: (1) `statusLine` = link OSC 8 cliccabile reso
// in fondo al terminale; (2) `spinnerVerbs` = il testo dell'ad nello slot del verbo
// "thinking" (impressione di brand; non cliccabile). La creative live sta nella
// cache cli-ad.json, aggiornata da cliSync senza ri-toccare settings.json.
export class ClaudeCliAdapter implements TargetAdapter {
  readonly name = "claude-cli";
  private readonly settings: string;
  private readonly home: string;
  constructor(settingsPath: string) {
    this.settings = resolve(settingsPath);
    this.home = dirname(dirname(this.settings)); // <home>/.claude/settings.json
  }

  private backupPath(): string { return this.settings + ".waitingads-bak"; }
  private scriptPath(): string { return join(waitingadsDir(this.home), STATUSLINE_SCRIPT_NAME); }
  private cachePath(): string { return cliAdPath(this.home); }
  private prevPath(): string { return join(waitingadsDir(this.home), PREV_NAME); }

  private readPrevStatusLine(): unknown {
    try {
      const v = JSON.parse(readFileSync(this.prevPath(), "utf8")).statusLine;
      return isForeignStatusLine(v) ? v : undefined;
    } catch { return undefined; }
  }
  private savedStatusLine(saved: string): unknown {
    if (saved === ABSENT) return undefined;
    const v = readTopLevel(saved, "statusLine");
    return isForeignStatusLine(v) ? v : undefined;
  }

  version(): string | null { return "cli"; }

  isPatched(): boolean {
    try {
      if (!existsSync(this.settings)) return false;
      const sl = readTopLevel(readFileSync(this.settings, "utf8"), "statusLine") as
        { command?: string } | undefined;
      return !!sl && typeof sl.command === "string" && sl.command.includes(STATUSLINE_SCRIPT_NAME);
    } catch { return false; }
  }

  preflight(): PreflightResult {
    try {
      if (!existsSync(this.settings)) return { ok: true, compatible: true, version: "cli" };
      const src = readFileSync(this.settings, "utf8");
      return parseable(src)
        ? { ok: true, compatible: true, version: "cli" }
        : { ok: true, compatible: false, version: "cli", reason: "settings.json not parseable" };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  private statusLineValue(): string {
    const cmd = `node ${JSON.stringify(this.scriptPath())}`;
    return JSON.stringify({ type: "command", command: cmd, padding: 0 });
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      const existed = existsSync(this.settings);
      const pristine = existed ? readFileSync(this.settings, "utf8") : null;
      if (pristine !== null && !parseable(pristine))
        return { ok: false, reason: "settings.json not parseable" };

      mkdirSync(dirname(this.settings), { recursive: true });
      if (!existsSync(this.backupPath()))
        writeFileSync(this.backupPath(), pristine === null ? ABSENT : pristine, "utf8");
      mkdirSync(waitingadsDir(this.home), { recursive: true });

      // Chain-capture: salva una statusLine utente preesistente (non nostra).
      const prevSl = pristine !== null ? readTopLevel(pristine, "statusLine") : undefined;
      if (isForeignStatusLine(prevSl)) {
        const json = JSON.stringify({ statusLine: prevSl });
        if (!existsSync(this.prevPath()) || readFileSync(this.prevPath(), "utf8") !== json)
          writeFileSync(this.prevPath(), json, "utf8");
      }

      // Script (idempotente: riscrivi solo se cambiato).
      const script = buildStatuslineScript(this.cachePath(), this.prevPath());
      if (!existsSync(this.scriptPath()) || readFileSync(this.scriptPath(), "utf8") !== script)
        writeFileSync(this.scriptPath(), script, "utf8");

      // Cache iniziale così la statusline ha subito qualcosa da mostrare.
      writeCliAdCache(this.home, {
        adText: p.adText || "", clickUrl: p.clickUrl || "", iconUrl: "", adId: "",
      });

      const base = pristine ?? "{\n}\n";
      let next = upsertStatusLine(base, this.statusLineValue());
      if (p.adText)
        next = upsertSpinnerVerbs(next, JSON.stringify({ mode: "replace", verbs: [p.adText] }));
      if (!existed || next !== pristine) writeFileSync(this.settings, next, "utf8");
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(): RestoreResult {
    try {
      const bak = this.backupPath();
      if (!existsSync(bak))
        return { ok: true, restored: false, reason: "no backup present" };
      const saved = readFileSync(bak, "utf8");
      if (existsSync(this.settings)) {
        const cur = readFileSync(this.settings, "utf8");
        if (!parseable(cur))
          return { ok: false, restored: false, reason: "settings.json not parseable" };
        const prevSl = this.readPrevStatusLine() ?? this.savedStatusLine(saved);
        const curSl = readTopLevel(cur, "statusLine");
        let next = cur;
        if (!isForeignStatusLine(curSl)) {
          next = prevSl !== undefined
            ? upsertStatusLine(cur, JSON.stringify(prevSl))
            : removeTopLevel(cur, "statusLine");
        }
        next = removeTopLevel(next, "spinnerVerbs");
        const emptyShell = /^[\s{}]*$/.test(next);
        if (saved === ABSENT && emptyShell) rmSync(this.settings);
        else if (next !== cur) writeFileSync(this.settings, next, "utf8");
      }
      for (const f of [this.scriptPath(), this.cachePath(), this.prevPath()])
        if (existsSync(f)) { try { rmSync(f); } catch { /* best-effort */ } }
      rmSync(bak);
      return { ok: true, restored: true };
    } catch (e) {
      return { ok: false, restored: false, reason: String(e) };
    }
  }
}
