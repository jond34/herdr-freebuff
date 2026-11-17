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
# for that source, so the sequence is microsecond-scaled like the watcher's
# (`Date.now() * 1000`). Node is already required by the plugin and is the only
# clock here that agrees with the watcher; `date +%3N` is not portable: uutils
# coreutils ignores the width and returns nanoseconds, which overflows when
# scaled and turns the seq negative.

set -eu

. "$(dirname "$0")/common.sh"

pane="${1:-${HERDR_ACTIVE_PANE_ID:-$PANE_ID}}"

if [ -z "$pane" ]; then
  echo "register-pane: no pane id (pass one, or run it as a Herdr action)" >&2
  exit 1
fi

seq=$(node -e 'console.log(Date.now() * 1000)')

exec "$HERDR" pane report-agent "$pane" \
  --source freebuff \
  --agent freebuff \
  --state unknown \
  --seq "$seq"
