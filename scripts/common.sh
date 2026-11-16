#!/bin/sh
# Shared helpers for the Freebuff Herdr plugin.
# Sourced by launch.sh and doctor.sh. Safe outside Herdr where noted.

: "${HERDR_BIN_PATH:=herdr}"
HERDR="$HERDR_BIN_PATH"
PANE_ID="${HERDR_PANE_ID:-}"

# Herdr sets this for plugin commands. Direct shell use falls back to the
# directory containing this repository.
if [ -z "${HERDR_PLUGIN_ROOT:-}" ]; then
  HERDR_PLUGIN_ROOT=$(cd "$(dirname "$0")/.." && pwd)
fi
export HERDR_PLUGIN_ROOT

in_herdr() { [ "${HERDR_ENV:-}" = "1" ]; }

freebuff_config_dir() {
  if [ -n "${FREEBUFF_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$FREEBUFF_CONFIG_DIR"
  elif [ -n "${HOME:-}" ]; then
    printf '%s\n' "$HOME/.config/manicode"
  else
    return 1
  fi
}

freebuff_project_name() {
  printf '%s\n' "${FREEBUFF_PROJECT_NAME:-$(basename "$PWD")}"
}

freebuff_chat_dir() {
  config=$(freebuff_config_dir) || return 1
  printf '%s\n' "$config/projects/$(freebuff_project_name)/chats/$1"
}
