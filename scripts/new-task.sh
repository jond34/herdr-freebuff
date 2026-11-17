#!/bin/sh
# Open the Freebuff task pane in the caller's directory.
#
# Herdr runs plugin commands with the plugin directory as their working
# directory, so an action that opens a pane without --cwd starts it there.
# Freebuff keys its chats by the cwd basename, so that would also switch the
# project. Herdr puts the focused pane's directory in the invocation context.

set -eu

. "$(dirname "$0")/common.sh"

# Herdr opens a pane at $HOME when --cwd is not an existing directory, without
# reporting an error. A pane whose directory was deleted (a removed worktree, a
# cleaned scratch dir) would then file Freebuff chats under a project named
# after the user, so take the first candidate that is still a directory.
candidates=$(node -e 'try{const c=JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON||"{}");process.stdout.write([c.focused_pane_cwd,c.workspace_cwd].filter(Boolean).join("\n"))}catch{}' 2>/dev/null || true)
cwd=$PWD
while IFS= read -r candidate; do
  if [ -n "$candidate" ] && [ -d "$candidate" ]; then
    cwd=$candidate
    break
  fi
done <<EOF
$candidates
EOF

exec "$HERDR" plugin pane open \
  --plugin freebuff.integration \
  --entrypoint task \
  --placement split \
  --focus \
  --cwd "$cwd"
