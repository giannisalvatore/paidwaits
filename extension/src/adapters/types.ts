// Interfaccia comune a tutti i target patchabili (Claude Code webview, Claude
// CLI statusline, Codex webview, Codex CLI wrapper). Ogni metodo è never-throw e
// ritorna un risultato tipizzato: un target rotto non deve mai far fallire gli altri.

export interface OpResult {
  ok: boolean;
  reason?: string;
}

export interface PreflightResult extends OpResult {
  compatible: boolean;
  version: string | null;
}

export interface RestoreResult extends OpResult {
  restored: boolean;
}

// I nostri blocchi webview NON incorporano la creative: la chiedono live al
// loopback (GET /ad). I target CLI invece scrivono la creative su file, quindi
// hanno bisogno del testo corrente al momento dell'apply (poi lo aggiorna cliSync).
export interface PatchParams {
  loopbackPort: number;
  /** Testo creativo corrente — usato SOLO dai target CLI (statusline/wrapper).
   *  I target webview lo ignorano (fetchano /ad a runtime). */
  adText?: string;
  /** URL della landing — usato dai target CLI per il link OSC 8. */
  clickUrl?: string;
}

export interface TargetAdapter {
  readonly name: string;
  preflight(): PreflightResult;
  version(): string | null;
  applyPatch(p: PatchParams): OpResult;
  /** `keepCsp` (solo webview) ripristina la patch visibile ma tiene il
   *  rilassamento connect-src della CSP. Il deactivate di routine lo passa;
   *  il teardown esplicito (restore/sign-out) no. */
  restore(opts?: { keepCsp?: boolean }): RestoreResult;
  /** True se il target porta attualmente il nostro blocco/patch. */
  isPatched?(): boolean;
  /** Applica SOLO il rilassamento strutturale della CSP (connect-src) senza
   *  iniettare il blocco — così il loopback è raggiungibile appena arriva un ad.
   *  Solo per i target webview; gli altri lo omettono. */
  prime?(): OpResult;
}
