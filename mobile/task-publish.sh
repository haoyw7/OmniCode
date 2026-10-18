#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/mobile-publish
# The OS releases this lock even if the task is interrupted. Do not queue a
# second invocation: its caller must first decide whether the task is still done.
exec 9>build/mobile-publish/task.lock
if ! flock -n 9; then
  echo "Mobile publication is already running; retry after it finishes." >&2
  exit 1
fi
node mobile/task-publish.mjs "$@"
