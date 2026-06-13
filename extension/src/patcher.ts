import * as fs from "node:fs";
import { locateClaudeCode, type ClaudeInstall } from "./locate";
import { buildInjectedScript, INJECT_START, INJECT_END } from "./inject";

const BACKUP_SUFFIX = ".paidwaits-bak";
// Firma di compatibilità: la classe CSS-module dello spinner di Claude Code. Se
// manca, è un bundle che non sappiamo targettare (lo script usa `[class*="spinnerRow_"]`
// a runtime). Non serve più estrarre i verbi: il rilevamento è basato sulla classe.
const SPINNER_SIGNATURE_RE = /spinnerRow_/;

export type PatchResult = { patched: boolean; reason?: string; version?: string };

function backupOnce(file: string): void {
  const backup = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

// Scrittura atomica: file temporaneo + rename, per non corrompere il bundle.
function writeAtomic(file: string, content: string): void {
  const tmp = file + ".paidwaits-tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function stripBlock(source: string): string {
  const start = source.indexOf(INJECT_START);
  if (start < 0) return source;
  const end = source.indexOf(INJECT_END, start);
  if (end < 0) return source;
  return source.slice(0, start) + source.slice(end + INJECT_END.length);
}

// Inietta l'overlay nel webview e rilassa la CSP in extension.js.
// La creative NON è incorporata: lo script la chiede live al loopback (`GET /ad`),
// così una nuova campagna non richiede di ri-patchare il bundle.
export function patch(port: number): PatchResult {
  const install = locateClaudeCode();
  if (!install) return { patched: false, reason: "claude_code_not_found" };

  const webviewSource = fs.readFileSync(install.webview, "utf8");
  if (!SPINNER_SIGNATURE_RE.test(webviewSource)) {
    return { patched: false, reason: "spinner_signature_not_found" };
  }

  // 1) webview/index.js — overlay
  backupOnce(install.webview);
  const clean = stripBlock(webviewSource);
  writeAtomic(install.webview, `${clean}\n${buildInjectedScript(port)}\n`);

  // 2) extension.js — rilassa la CSP per permettere il fetch verso il loopback
  patchCsp(install, port);

  return { patched: true, version: versionOf(install) };
}

function patchCsp(install: ClaudeInstall, port: number): void {
  const source = fs.readFileSync(install.extension, "utf8");
  const directive = `connect-src http://127.0.0.1:${port} http://localhost:${port}`;
  if (source.includes(directive)) return; // già applicato
  backupOnce(install.extension);
  // La CSP del webview parte da "default-src 'none'": vi aggiungiamo connect-src.
  const patched = source.split("default-src 'none'").join(`default-src 'none';${directive}`);
  writeAtomic(install.extension, patched);
}

export function restore(): PatchResult {
  const install = locateClaudeCode();
  if (!install) return { patched: false, reason: "claude_code_not_found" };
  for (const file of [install.webview, install.extension]) {
    const backup = file + BACKUP_SUFFIX;
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, file);
      fs.rmSync(backup);
    }
  }
  return { patched: false };
}

export function isPatched(): boolean {
  const install = locateClaudeCode();
  if (!install) return false;
  try {
    return fs.readFileSync(install.webview, "utf8").includes(INJECT_START);
  } catch {
    return false;
  }
}

function versionOf(install: ClaudeInstall): string {
  const match = install.dir.match(/claude-code-([\d.]+)/);
  return match ? match[1] : "?";
}
