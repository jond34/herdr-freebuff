#!/bin/sh
# Print diagnostic evidence for an unresolved Freebuff pane.
# Usage: doctor.sh [launcher-pid] [chat-id]

set -eu

. "$(dirname "$0")/common.sh"

exec node "$HERDR_PLUGIN_ROOT/scripts/status-watcher.js" --doctor "$@"
