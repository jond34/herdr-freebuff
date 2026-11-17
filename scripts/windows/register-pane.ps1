# Register a pane as a Freebuff agent in Herdr.
#
# A pane opened by the plugin reports itself through the status watcher. A
# Freebuff you started by hand has no watcher, so Herdr leaves it `unknown`.
# This reports the pane explicitly, with state `unknown`: it says "Freebuff runs
# here", and claims nothing about what it is doing.
#
# Usage: register-pane.ps1 [pane-id]
#
# Herdr drops a report whose --seq is not greater than the last one it accepted
# for that source, so the sequence is microsecond-scaled like the watcher's.

param([string]$Pane = '')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$pane = $Pane
if (-not $pane) { $pane = $env:HERDR_ACTIVE_PANE_ID }
if (-not $pane) { $pane = $PaneId }
if (-not $pane) {
  Write-Error 'register-pane: no pane id (pass one, or run it as a Herdr action)' -ErrorAction Continue
  exit 1
}

$seq = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000

& $HerdrBin pane report-agent $pane `
  --source freebuff `
  --agent freebuff `
  --state unknown `
  --seq "$seq"

if ($null -eq $LASTEXITCODE) { exit 0 }
exit $LASTEXITCODE
