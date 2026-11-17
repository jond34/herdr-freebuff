# Shared helpers for the Freebuff Herdr plugin on Windows.
#
# Dot-sourced by the entrypoints, and the counterpart of scripts/common.sh.
# Keep the two in step: the manifest test asserts every Windows entrypoint has a
# Unix twin and that both exist.

$ErrorActionPreference = 'Stop'

if (-not $env:HERDR_PLUGIN_ROOT) {
  # Herdr sets this for plugin commands. A direct shell run falls back to the
  # directory containing this repository.
  $env:HERDR_PLUGIN_ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$HerdrBin = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
$PaneId = $env:HERDR_PANE_ID

function Test-InHerdr {
  return $env:HERDR_ENV -eq '1'
}

function Get-FreebuffConfigDir {
  if ($env:FREEBUFF_CONFIG_DIR) { return $env:FREEBUFF_CONFIG_DIR }
  # Freebuff resolves its config from the user profile on Windows; Node's
  # os.homedir() in the watcher resolves to the same place.
  if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE '.config\manicode') }
  return $null
}

function Get-FreebuffProjectName {
  if ($env:FREEBUFF_PROJECT_NAME) { return $env:FREEBUFF_PROJECT_NAME }
  return (Split-Path -Leaf (Get-Location).Path)
}

function Get-FreebuffChatDir {
  param([string]$ChatId)
  $config = Get-FreebuffConfigDir
  if (-not $config) { return $null }
  return (Join-Path $config ('projects\{0}\chats\{1}' -f (Get-FreebuffProjectName), $ChatId))
}

function Test-FreebuffChatId {
  param([string]$ChatId)
  if (-not $ChatId) { return $false }
  if ($ChatId.Contains('..') -or $ChatId.Contains('/') -or $ChatId.Contains('\')) {
    return $false
  }
  return $ChatId -match '^[A-Za-z0-9._:-]+$'
}
