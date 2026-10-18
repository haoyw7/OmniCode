#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ $# -gt 0 ]]; then
  # Help and dry-run never create directories or acquire publication locks.
  exec node scripts/dev-refresh.mjs "$@"
fi

state_dir="${MONOCODE_DESKTOP_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/monocode/desktop-updates}"
mkdir -p "$state_dir"
exec 8>"$state_dir/dev-refresh.lock"
flock -n 8 || { echo "Another development refresh is running." >&2; exit 1; }
# Tauri development compilation must not overlap desktop LAN publication.
exec 9>"$state_dir/task.lock"
flock -n 9 || { echo "Desktop publication is running; retry when it finishes." >&2; exit 1; }
node scripts/dev-refresh.mjs
