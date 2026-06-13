import * as fs from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams } from "../types";
import { buildClaudeCodeBlock, BLOCK_START, BLOCK_END } from "./block";

// Firma di compatibilità: la classe CSS-module dello spinner di Claude Code. Se
// manca, è un bundle che non sappiamo targettare (lo script usa `[class*="spinnerRow_"]`).
const SPINNER_SIGNATURE_RE = /spinnerRow_/;
const BACKUP_SUFFIX = ".paidwaits-bak";

function backupOnce(file: string): void {
  const backup = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
}
// Scrittura atomica: temp + rename, per non corrompere il bundle.
function writeAtomic(file: string, content: string): void {
  const tmp = file + ".paidwaits-tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function stripBlock(source: string): string {
  const start = source.indexOf(BLOCK_START);
  if (start < 0) return source;
  const end = source.indexOf(BLOCK_END, start);
  if (end < 0) return source;
  return source.slice(0, start) + source.slice(end + BLOCK_END.length);
}

export class ClaudeCodeAdapter implements TargetAdapter {
  readonly name = "claude-code";
  private readonly target: string; // <ext>/webview/index.js
  constructor(target: string) { this.target = resolve(target); }

  // sibling <ext>/extension.js (per il rilassamento CSP del loopback)
  private extTarget(): string { return join(dirname(dirname(this.target)), "extension.js"); }

  version(): string | null {
    const m = /anthropic\.claude-code-(\d+\.\d+\.\d+)/.exec(this.target);
    if (m) return m[1];
    const loose = /anthropic\.claude-code-([0-9][^/\\]*)/.exec(this.target);
    return loose ? loose[1] : "unknown";
  }

  isPatched(): boolean {
    try {
      return fs.existsSync(this.target) &&
        fs.readFileSync(this.target, "utf8").includes(BLOCK_START);
    } catch { return false; }
  }

  preflight(): PreflightResult {
    try {
      if (!fs.existsSync(this.target))
        return { ok: true, compatible: false, version: null, reason: "target not found" };
      const src = fs.readFileSync(this.target, "utf8");
      return SPINNER_SIGNATURE_RE.test(src)
        ? { ok: true, compatible: true, version: this.version() }
        : { ok: true, compatible: false, version: this.version(), reason: "spinner signature not found" };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  // Rilassa la CSP di extension.js per permettere fetch/sendBeacon verso il loopback
  // (impression/click). Il click-OUT verso l'inserzionista è l'<a href> aperto dal
  // host di VS Code, CSP-exempt: anche se la CSP fallisse, il click naviga comunque.
  private patchCsp(port: number): void {
    try {
      const ext = this.extTarget();
      if (!fs.existsSync(ext)) return;
      const source = fs.readFileSync(ext, "utf8");
      const directive = `connect-src http://127.0.0.1:${port} http://localhost:${port}`;
      if (source.includes(directive)) return; // idempotente
      const backup = ext + BACKUP_SUFFIX;
      if (!fs.existsSync(backup)) fs.copyFileSync(ext, backup);
      const patched = source.split("default-src 'none'").join(`default-src 'none';${directive}`);
      writeAtomic(ext, patched);
    } catch { /* best-effort: il click via href funziona comunque */ }
  }

  prime(): OpResult {
    // Il nostro claude-code rilassa la CSP dentro applyPatch; prime() la applica
    // da sola al boot. La porta non è nota qui: prime è chiamato senza ad in mano,
    // quindi è un no-op utile solo se conoscessimo la porta — la lasciamo come hook.
    return { ok: true };
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      if (!fs.existsSync(this.target)) return { ok: false, reason: "target not found" };
      const src = fs.readFileSync(this.target, "utf8");
      if (!SPINNER_SIGNATURE_RE.test(src)) return { ok: false, reason: "spinner signature not found" };
      backupOnce(this.target);
      const clean = stripBlock(src);
      writeAtomic(this.target, `${clean}\n${buildClaudeCodeBlock(p.loopbackPort)}\n`);
      this.patchCsp(p.loopbackPort);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(opts?: { keepCsp?: boolean }): RestoreResult {
    try {
      // index.js
      const bak = this.target + BACKUP_SUFFIX;
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, this.target);
        fs.rmSync(bak);
      }
      // extension.js (CSP) — solo su teardown esplicito (keepCsp assente)
      if (!opts?.keepCsp) {
        const ext = this.extTarget();
        const extBak = ext + BACKUP_SUFFIX;
        if (fs.existsSync(extBak)) {
          fs.copyFileSync(extBak, ext);
          fs.rmSync(extBak);
        }
      }
      return { ok: true, restored: true };
    } catch (e) {
      return { ok: false, restored: false, reason: String(e) };
    }
  }
}
