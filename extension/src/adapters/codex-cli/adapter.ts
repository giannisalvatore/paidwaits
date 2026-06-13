import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams } from "../types";
import { sha256 } from "../../util/crypto";
import { buildWrapperSh, buildWrapperCmd, CODEX_CLI_MARKER } from "./wrappers";
import { waitingadsDir, stripControlChars } from "../../cliAd";

const AD_FILE_NAME = "codex-cli-ad.txt";

// Wrappa lo shim npm `codex` con un piccolo script che stampa una riga di ad sopra
// l'invocazione reale. Reversibile: lo shim pristino è copiato a <stem>.waitingads-orig.
// NB: Codex CLI non installato qui → non verificato.
export class CodexCliAdapter implements TargetAdapter {
  readonly name = "codex-cli";
  private readonly shim: string;
  private readonly home: string;
  private readonly isWin: boolean;
  constructor(shimPath: string, home: string) {
    this.shim = resolve(shimPath);
    this.home = resolve(home);
    this.isWin = this.shim.toLowerCase().endsWith(".cmd");
  }

  private adFilePath(): string { return join(waitingadsDir(this.home), AD_FILE_NAME); }
  private backupPath(): string {
    const dir = dirname(this.shim);
    if (this.isWin) return join(dir, basename(this.shim, ".cmd") + ".waitingads-orig.cmd");
    return join(dir, basename(this.shim) + ".waitingads-orig");
  }

  version(): string | null { return "cli"; }

  isPatched(): boolean {
    try {
      return existsSync(this.shim) && readFileSync(this.shim, "utf8").includes(CODEX_CLI_MARKER);
    } catch { return false; }
  }

  preflight(): PreflightResult {
    try {
      if (!existsSync(this.shim))
        return { ok: true, compatible: false, version: "cli", reason: "shim not found" };
      const raw = readFileSync(this.shim, "utf8");
      if (raw.includes(CODEX_CLI_MARKER)) return { ok: true, compatible: true, version: "cli" };
      if (!/@openai[\/\\]codex|codex\.js/.test(raw))
        return { ok: true, compatible: false, version: "cli", reason: "shim doesn't look like @openai/codex" };
      return { ok: true, compatible: true, version: "cli" };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      if (!existsSync(this.shim)) return { ok: false, reason: "shim not found" };
      mkdirSync(waitingadsDir(this.home), { recursive: true });
      writeFileSync(this.adFilePath(),
        (stripControlChars(p.adText || "") || "WaitingAds") + "\n", "utf8");
      const current = readFileSync(this.shim, "utf8");
      if (current.includes(CODEX_CLI_MARKER)) return { ok: true }; // idempotente
      if (!existsSync(this.backupPath())) copyFileSync(this.shim, this.backupPath());
      const wrapper = this.isWin
        ? buildWrapperCmd(this.adFilePath(), this.backupPath())
        : buildWrapperSh(this.adFilePath(), this.backupPath());
      writeFileSync(this.shim, wrapper, "utf8");
      if (!this.isWin) { try { chmodSync(this.shim, 0o755); } catch { /* best-effort */ } }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(): RestoreResult {
    try {
      const bak = this.backupPath();
      if (!existsSync(bak)) return { ok: true, restored: false, reason: "no backup present" };
      const pristine = readFileSync(bak);
      writeFileSync(this.shim, pristine);
      if (sha256(readFileSync(this.shim)) !== sha256(pristine))
        return { ok: false, restored: false, reason: "sha256 mismatch after restore" };
      rmSync(bak);
      if (existsSync(this.adFilePath())) { try { rmSync(this.adFilePath()); } catch { /* best-effort */ } }
      return { ok: true, restored: true };
    } catch (e) {
      return { ok: false, restored: false, reason: String(e) };
    }
  }
}
