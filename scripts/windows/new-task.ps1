# Open the Freebuff task pane in the caller's directory.
#
# Herdr runs plugin commands with the plugin directory as their working
# directory, so an action that opens a pane without --cwd starts it there.
# Freebuff keys its chats by the cwd basename, so that would also switch the
# project. Herdr puts the focused pane's directory in the invocation context.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# Herdr opens a pane at the user profile when --cwd is not an existing directory,
# without reporting an error: a pane whose directory was deleted would file
# Freebuff chats under a project named after the user. Take the first surviving
# candidate instead.
$cwd = (Get-Location).Path
$candidates = @()
if ($env:HERDR_PLUGIN_CONTEXT_JSON) {
  try {
    $context = $env:HERDR_PLUGIN_CONTEXT_JSON | ConvertFrom-Json
    $candidates = @($context.focused_pane_cwd, $context.workspace_cwd)
  } catch {}
}
foreach ($candidate in $candidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
    $cwd = $candidate
    break
  }
}

& $HerdrBin plugin pane open `
  --plugin freebuff.integration `
  --entrypoint task `
  --placement split `
  --focus `
  --cwd $cwd

if ($null -eq $LASTEXITCODE) { exit 0 }
exit $LASTEXITCODE
