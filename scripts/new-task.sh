#!/bin/sh
# Open the Freebuff task pane in the caller's directory.
#
# Herdr runs plugin commands with the plugin directory as their working
# directory, so an action that opens a pane without --cwd starts it there.
# Freebuff keys its chats by the cwd basename, so that would also switch the
# project. Resolve the directory from the pane the action ran in.

set -eu

. "$(dirname "$0")/common.sh"

pane="${HERDR_ACTIVE_PANE_ID:-$PANE_ID}"
cwd=$PWD

if [ -n "$pane" ]; then
  reported=$("$HERDR" pane get "$pane" 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const p=JSON.parse(d).result.pane;process.stdout.write(p.foreground_cwd||p.cwd||"")}catch{}})' \
    2>/dev/null || true)
  [ -z "$reported" ] || cwd=$reported
fi

exec "$HERDR" plugin pane open \
  --plugin freebuff.integration \
  --entrypoint task \
  --placement split \
  --focus \
  --cwd "$cwd"
