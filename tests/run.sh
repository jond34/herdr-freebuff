#!/bin/sh
# Phase 2 verification entrypoint.
#
# Run: sh tests/run.sh

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

sh -n "$ROOT/scripts/common.sh"
sh -n "$ROOT/scripts/launch.sh"
sh -n "$ROOT/scripts/doctor.sh"
sh -n "$HERE/run.sh"
node --check "$ROOT/scripts/status-watcher.js"

exec node --test --test-concurrency=1 "$HERE/phase2.test.js"
