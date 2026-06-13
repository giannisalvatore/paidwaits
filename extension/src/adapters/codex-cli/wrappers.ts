// Wrapper reversibili attorno allo shim npm `codex`: stampano una riga di ad letta
// da un file e poi delegano allo shim originale (salvato a backupPath). NB: Codex
// CLI non installato qui → non verificato. Marker per riconoscere/strippare.
export const CODEX_CLI_MARKER = "WAITINGADS-CODEX-CLI";

export function buildWrapperSh(adPath: string, backupPath: string): string {
  return `#!/bin/sh
# ===== ${CODEX_CLI_MARKER} =====
# Wrapper reversibile attorno allo shim npm codex. Stampa una riga di ad letta da
# "${adPath}" poi exec lo shim originale a "${backupPath}".
AD_FILE="${adPath}"
AD_TEXT="WaitingAds"
if [ -r "$AD_FILE" ]; then
  AD_TEXT=$(head -n 1 "$AD_FILE" 2>/dev/null || echo "WaitingAds")
fi
printf '\\n  [ad]  %s\\n\\n' "$AD_TEXT"
exec "${backupPath}" "$@"
`;
}

export function buildWrapperCmd(adPath: string, backupPath: string): string {
  return `@ECHO off
REM ===== ${CODEX_CLI_MARKER} =====
REM Wrapper reversibile attorno allo shim npm codex. Stampa una riga di ad letta da
REM "${adPath}" poi delega allo shim originale a "${backupPath}".
setlocal enabledelayedexpansion
set "__WA_AD_FILE=${adPath}"
set "__WA_AD=WaitingAds"
if exist "%__WA_AD_FILE%" (
  for /f "usebackq delims=" %%A in ("%__WA_AD_FILE%") do (
    set "__WA_AD=%%A"
    goto :__wa_after
  )
)
:__wa_after
echo.
echo   [ad]  !__WA_AD!
echo.
endlocal & call "${backupPath}" %*
`;
}
