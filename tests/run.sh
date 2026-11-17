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
sh -n "$ROOT/scripts/new-task.sh"
sh -n "$HERE/run.sh"
node --check "$ROOT/scripts/status-watcher.js"
node --check "$ROOT/scripts/watcher/binding.js"
node --check "$ROOT/scripts/watcher/turns.js"
node --check "$ROOT/scripts/watcher/herdr.js"
node --check "$ROOT/scripts/watcher/doctor.js"
node --check "$ROOT/scripts/platform/index.js"
node --check "$ROOT/scripts/platform/unix.js"
node --check "$ROOT/scripts/platform/windows.js"

exec node --test --test-concurrency=1 \
  "$HERE/watcher.test.js" \
  "$HERE/register-pane.test.js" \
  "$HERE/new-task.test.js" \
  "$HERE/platform.test.js" \
  "$HERE/manifest.test.js"
