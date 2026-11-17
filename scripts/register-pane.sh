#!/bin/sh
# Register a pane as a Freebuff agent in Herdr.
#
# A pane opened by the plugin reports itself through the status watcher. A
# `freebuff` you started by hand has no watcher, so Herdr leaves it `unknown`.
# This reports the pane explicitly, with state `unknown`: it says "Freebuff
# runs here", and claims nothing about what it is doing.
#
# Usage: register-pane.sh [pane-id]
#
# Herdr drops a report whose --seq is not greater than the last one it accepted
# for that source, so the sequence is microsecond-scaled like the watcher's.
# A seconds-scale value silently loses to an earlier watcher report.

set -eu

. "$(dirname "$0")/common.sh"

pane="${1:-${HERDR_ACTIVE_PANE_ID:-$PANE_ID}}"

if [ -z "$pane" ]; then
  echo "register-pane: no pane id (pass one, or run it as a Herdr action)" >&2
  exit 1
fi

seq=$(($(date +%s%3N) * 1000))

exec "$HERDR" pane report-agent "$pane" \
  --source freebuff \
  --agent freebuff \
  --state unknown \
  --seq "$seq"
