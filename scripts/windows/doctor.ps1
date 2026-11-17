# Print diagnostic evidence for an unresolved Freebuff pane.
#
# Usage: doctor.ps1 [launcher-pid] [chat-id]

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Error 'node is not on PATH; status reporting needs it' -ErrorAction Continue
  exit 1
}

$watcher = Join-Path $env:HERDR_PLUGIN_ROOT 'scripts\status-watcher.js'
& $node $watcher '--doctor' @Rest
if ($null -eq $LASTEXITCODE) { exit 0 }
exit $LASTEXITCODE
