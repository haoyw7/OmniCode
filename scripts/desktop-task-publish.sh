#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
desktop_state_dir="${MONOCODE_DESKTOP_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/monocode/desktop-updates}"
mkdir -p "$desktop_state_dir"
# Shared across worktrees because they publish to the same LAN feed.
exec 9>"$desktop_state_dir/task.lock"
if ! flock -n 9; then
  echo "Desktop publication is already running; retry after it finishes." >&2
  exit 1
fi
node scripts/desktop-task-publish.mjs "$@"
