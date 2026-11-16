#!/bin/sh
# Launch Freebuff inside a Herdr plugin pane.
#
# Herdr runs a pane entrypoint as the pane's own PTY process. Freebuff needs a
# real TTY, so a pane is the right entrypoint rather than an action or CLI call.
#
# Usage: launch.sh <task|resume-last|resume-named> [chat-id]

set -eu

mode="${1:-task}"
name="${2:-}"
start_chat_id=""
start_source="startup"

. "$(dirname "$0")/common.sh"

freebuff_bin="${FREEBUFF_BIN_PATH:-}"
if [ -z "$freebuff_bin" ]; then
  freebuff_bin=$(command -v freebuff 2>/dev/null || true)
fi
if [ -z "$freebuff_bin" ] || [ ! -x "$freebuff_bin" ]; then
  echo "freebuff is not executable or not on PATH" >&2
  exit 1
fi

node_bin=$(command -v node 2>/dev/null || true)
watcher="$HERDR_PLUGIN_ROOT/scripts/status-watcher.js"

safe_chat_id() {
  case "$1" in
    ''|*/*|*..*|*[!A-Za-z0-9._:-]*) return 1 ;;
  esac
  return 0
}

chat_dir_for() {
  freebuff_chat_dir "$1"
}

case "$mode" in
  task)
    start_source="startup"
    ;;
  resume-last)
    start_source="resume"
    ;;
  resume-named)
    if [ -z "$name" ]; then
      name=$(printf '%s' "${HERDR_PLUGIN_CONTEXT_JSON:-}" 2>/dev/null \
        | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.conversation_id||j.session_id||"")}catch{}})' 2>/dev/null || true)
    fi
    if ! safe_chat_id "$name"; then
      echo "resume-named needs a valid chat id" >&2
      exit 1
    fi
    chat_dir=$(chat_dir_for "$name") || {
      echo "cannot resolve the Freebuff config directory" >&2
      exit 1
    }
    if [ ! -d "$chat_dir" ]; then
      echo "Freebuff chat $name does not exist in this project" >&2
      exit 1
    fi
    start_chat_id="$name"
    start_source="resume"
    ;;
  *)
    echo "unknown launch mode: $mode" >&2
    exit 1
    ;;
esac

export FREEBUFF_SESSION_START_SOURCE="$start_source"

start_watcher() {
  [ -n "$node_bin" ] || return 0
  [ -f "$watcher" ] || return 0
  if in_herdr && [ -n "$PANE_ID" ]; then
    # $$ becomes the Freebuff process after exec. The watcher resolves the
    # launcher's descendants, because Freebuff writes logs with the child PID.
    "$node_bin" "$watcher" "$$" "$PANE_ID" "$start_chat_id" >/dev/null 2>&1 &
  fi
}

case "$mode" in
  task)
    start_watcher
    exec "$freebuff_bin"
    ;;
  resume-last)
    start_watcher
    exec "$freebuff_bin" --continue
    ;;
  resume-named)
    start_watcher
    exec "$freebuff_bin" --continue "$name"
    ;;
esac
