# Launch Freebuff inside a Herdr plugin pane.
#
# Herdr runs a pane entrypoint as the pane's own console process. Freebuff needs
# a real console, so a pane is the right entrypoint rather than an action.
#
# Usage: launch.ps1 <task|resume-last|resume-named> [chat-id]

param(
  [string]$Mode = 'task',
  [string]$Name = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$startChatId = ''
$startSource = 'startup'

$freebuff = $env:FREEBUFF_BIN_PATH
if (-not $freebuff) {
  # PATHEXT resolution: an npm install answers with freebuff.cmd (or its
  # freebuff.ps1 wrapper), which is what belongs in the pane.
  $command = Get-Command freebuff -ErrorAction SilentlyContinue
  if ($command) { $freebuff = $command.Source }
}
if (-not $freebuff -or -not (Test-Path -LiteralPath $freebuff -PathType Leaf)) {
  Write-Error 'freebuff is not executable or not on PATH' -ErrorAction Continue
  exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$watcher = Join-Path $env:HERDR_PLUGIN_ROOT 'scripts\status-watcher.js'

switch ($Mode) {
  'task' { $startSource = 'startup' }
  'resume-last' { $startSource = 'resume' }
  'resume-named' {
    if (-not $Name -and $env:HERDR_PLUGIN_CONTEXT_JSON) {
      try {
        $context = $env:HERDR_PLUGIN_CONTEXT_JSON | ConvertFrom-Json
        if ($context.conversation_id) { $Name = $context.conversation_id }
        elseif ($context.session_id) { $Name = $context.session_id }
      } catch {}
    }
    if (-not (Test-FreebuffChatId $Name)) {
      Write-Error 'resume-named needs a valid chat id' -ErrorAction Continue
      exit 1
    }
    $chatDir = Get-FreebuffChatDir $Name
    if (-not $chatDir -or -not (Test-Path -LiteralPath $chatDir -PathType Container)) {
      Write-Error "Freebuff chat $Name does not exist in this project" -ErrorAction Continue
      exit 1
    }
    $startChatId = $Name
    $startSource = 'resume'
  }
  default {
    Write-Error "unknown launch mode: $Mode" -ErrorAction Continue
    exit 1
  }
}

$env:FREEBUFF_SESSION_START_SOURCE = $startSource

if ($node -and (Test-Path -LiteralPath $watcher -PathType Leaf) -and (Test-InHerdr) -and $PaneId) {
  # $PID is this launcher, which outlives Freebuff: the watcher stops when the
  # pane closes. It binds the chat log written after it starts, because Windows
  # offers no process tree cheap enough to poll.
  $watcherArgs = '"{0}" {1} "{2}" "{3}"' -f $watcher, $PID, $PaneId, $startChatId
  Start-Process -FilePath $node -ArgumentList $watcherArgs -NoNewWindow | Out-Null
}

switch ($Mode) {
  'task' { & $freebuff }
  'resume-last' { & $freebuff --continue }
  'resume-named' { & $freebuff --continue $Name }
}

if ($null -eq $LASTEXITCODE) { exit 0 }
exit $LASTEXITCODE
