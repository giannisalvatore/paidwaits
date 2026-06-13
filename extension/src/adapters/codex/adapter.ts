import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams } from "../types";
import { sha256 } from "../../util/crypto";
import { buildCodexBlock } from "./block";

// NB: Codex non installato qui → adapter portato da kickbacks e NON verificato.
// Inerte finché l'estensione Codex non esiste (registry.locate ritorna null).
const BLOCK_START = "/* PAIDWADS-START */";
const BLOCK_END = "/* PAIDWADS-END */";

// L'iniezione Codex è un wrapper INLINE `arg=(<block>)||arg;`. Lo strip deve
// togliere l'INTERO wrapper (non solo il corpo tra marker), altrimenti un
// re-derive da file già patchato lascerebbe `arg=()||arg;`, errore di sintassi.
const ID = "[A-Za-z_$][\\w$]*";
const STRIP_RES: RegExp[] = [
  new RegExp(
    "(?:" + ID + "=\\()?" +
    "\\/\\* PAIDWADS-START \\*\\/[\\s\\S]*?\\/\\* PAIDWADS-END \\*\\/" +
    "(?:\\)\\|\\|" + ID + ";)?", "g"),
  new RegExp(ID + "=\\(\\)\\|\\|" + ID + ";", "g"),
];
function stripInjection(s: string): string {
  for (const re of STRIP_RES) s = s.replace(re, "");
  return s;
}

const EXPORT_RE = /export\s*\{([^}]*)\}/;
const JSX_RE = /\(0,\s*([A-Za-z0-9_$]+)\.jsxs?\)/;
const CSP_CONNECT_RE = /`connect-src\s+([^`]*)`/g;
const CSP_MARK = "connect-src http://127.0.0.1:*";
const CSP_INSERT = "http://127.0.0.1:* http://localhost:*";

export class CodexAdapter implements TargetAdapter {
  readonly name = "codex";
  private readonly target: string; // <ext>/webview/assets/thinking-shimmer-<hash>.js
  constructor(target: string) { this.target = resolve(target); }

  private backupPath(): string { return this.target + ".waitingads-bak"; }
  private existingBackupPath(): string | null {
    return existsSync(this.backupPath()) ? this.backupPath() : null;
  }
  private extensionRoot(): string { return dirname(dirname(dirname(this.target))); }
  private extTarget(): string | null {
    for (const p of [join(this.extensionRoot(), "out", "extension.js"),
                     join(this.extensionRoot(), "extension.js")]) {
      if (existsSync(p)) return p;
    }
    return null;
  }
  private extBackupPath(ext: string): string { return ext + ".waitingads-bak"; }

  private patchCsp(): void {
    try {
      const ext = this.extTarget();
      if (!ext) return;
      const src = readFileSync(ext, "utf8");
      if (src.includes(CSP_MARK)) return;
      let changed = false;
      const patched = src.replace(CSP_CONNECT_RE, (_m, rest: string) => {
        changed = true;
        return "`connect-src " + CSP_INSERT + " " + rest.trim() + "`";
      });
      if (!changed) return;
      const bak = this.extBackupPath(ext);
      if (!existsSync(bak)) writeFileSync(bak, Buffer.from(src, "utf8"));
      writeFileSync(ext, Buffer.from(patched, "utf8"));
    } catch { /* best-effort */ }
  }
  private restoreCsp(): void {
    try {
      const ext = this.extTarget();
      if (!ext) return;
      const bak = this.extBackupPath(ext);
      if (!existsSync(bak)) return;
      const pristine = readFileSync(bak);
      writeFileSync(ext, pristine);
      if (sha256(readFileSync(ext)) === sha256(pristine)) rmSync(bak);
    } catch { /* best-effort */ }
  }

  // Entry ThinkingShimmer: l'identifier riesportato `as n`, e il suo
  // `function NAME(ARG){` (punto d'inserzione subito dopo la `{`).
  private locateEntry(src: string): { name: string; arg: string; at: number } | null {
    const ex = EXPORT_RE.exec(src);
    if (!ex) return null;
    const m = /([A-Za-z0-9_$]+)\s+as\s+n\b/.exec(ex[1]);
    if (!m) return null;
    const sig = new RegExp("function\\s+" + m[1] + "\\s*\\(\\s*([A-Za-z0-9_$]+)\\s*\\)\\s*\\{").exec(src);
    if (!sig) return null;
    return { name: m[1], arg: sig[1], at: sig.index + sig[0].length };
  }
  private jsxName(src: string): string | null {
    const m = JSX_RE.exec(src);
    return m ? m[1] : null;
  }

  version(): string | null {
    const m = /openai\.chatgpt-([0-9][^/\\]*)/.exec(this.target);
    return m ? m[1] : "unknown";
  }

  isPatched(): boolean {
    try {
      return existsSync(this.target) && readFileSync(this.target, "utf8").includes(BLOCK_START);
    } catch { return false; }
  }

  preflight(): PreflightResult {
    try {
      if (!existsSync(this.target))
        return { ok: true, compatible: false, version: null, reason: "target not found" };
      const raw = readFileSync(this.existingBackupPath() ?? this.target, "utf8");
      const src = stripInjection(raw);
      const ok = this.locateEntry(src) !== null
        && /defaultMessage:`Thinking`/.test(src)
        && this.jsxName(src) !== null;
      return ok
        ? { ok: true, compatible: true, version: this.version() }
        : { ok: true, compatible: false, version: this.version(),
            reason: "thinking-shimmer anchors not found (incompatible build)" };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      if (!existsSync(this.target)) return { ok: false, reason: "target not found" };
      const live = readFileSync(this.target, "utf8");
      const bak = this.existingBackupPath();
      const pristine = stripInjection(bak ? readFileSync(bak, "utf8") : live);
      const loc = this.locateEntry(pristine);
      if (!loc) return { ok: false, reason: "anchors not found" };
      if (!bak) writeFileSync(this.backupPath(), Buffer.from(pristine, "utf8"));
      const block = buildCodexBlock(p.loopbackPort);
      const out = pristine.slice(0, loc.at) +
        BLOCK_START + loc.arg + "=(" + block + ")||" + loc.arg + ";" + BLOCK_END +
        pristine.slice(loc.at);
      const buf = Buffer.from(out, "utf8");
      if (sha256(buf) !== sha256(readFileSync(this.target))) writeFileSync(this.target, buf);
      this.patchCsp();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(opts?: { keepCsp?: boolean }): RestoreResult {
    try {
      const bak = this.existingBackupPath();
      if (bak === null) {
        if (!opts?.keepCsp) this.restoreCsp();
        return { ok: true, restored: false, reason: "no backup present" };
      }
      const pristine = readFileSync(bak);
      writeFileSync(this.target, pristine);
      if (sha256(readFileSync(this.target)) !== sha256(pristine))
        return { ok: false, restored: false, reason: "sha256 mismatch after restore" };
      rmSync(bak);
      if (!opts?.keepCsp) this.restoreCsp();
      return { ok: true, restored: true };
    } catch (e) {
      return { ok: false, restored: false, reason: String(e) };
    }
  }
}
