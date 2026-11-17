#!/bin/sh
# Plugin verification entrypoint.
#
# Run: sh tests/run.sh

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

sh -n "$ROOT/scripts/common.sh"
sh -n "$ROOT/scripts/launch.sh"
sh -n "$ROOT/scripts/doctor.sh"
sh -n "$ROOT/scripts/register-pane.sh"
sh -n "$HERE/run.sh"
node --check "$ROOT/scripts/status-watcher.js"

exec node --test --test-concurrency=1 "$HERE/watcher.test.js" "$HERE/register-pane.test.js"
