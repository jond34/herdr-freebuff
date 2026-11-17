#!/bin/sh
# Open the Freebuff task pane in the caller's directory.
#
# Herdr runs plugin commands with the plugin directory as their working
# directory, so an action that opens a pane without --cwd starts it there.
# Freebuff keys its chats by the cwd basename, so that would also switch the
# project. Herdr puts the focused pane's directory in the invocation context.

set -eu

. "$(dirname "$0")/common.sh"

cwd=$(node -e 'try{const c=JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON||"{}");process.stdout.write(c.focused_pane_cwd||c.workspace_cwd||"")}catch{}' 2>/dev/null || true)
[ -n "$cwd" ] || cwd=$PWD

exec "$HERDR" plugin pane open \
  --plugin freebuff.integration \
  --entrypoint task \
  --placement split \
  --focus \
  --cwd "$cwd"
