# Read from wsl.exe stdin; protocol frames follow the final exec on that pipe.
set -eu
umask 077
exec 3>&1 1>&2
SOURCE=$(wslpath -u "$1")
BASE="$HOME/.omnicode/remote"
RUN="$BASE/run"
# During migration, the previous Host can still own rpc.sock and its database.
SOCKET="$RUN/exec.sock"
mkdir -p "$BASE/host" "$RUN"
chmod 700 "$BASE" "$BASE/host" "$RUN"
exec 9>"$RUN/setup.lock"
flock -w 60 9 || { echo 'Another WSL setup is still running. Retry shortly.'; exit 1; }
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo 'Unsupported WSL architecture.'; exit 1 ;;
esac
[ "$(cat "$SOURCE/ARCH")" = "$ARCH" ] || { echo 'This OmniCode build does not match the WSL architecture.'; exit 1; }
VERSION=$(tr -cd '0-9A-Za-z.+-' < "$SOURCE/VERSION")
SUMS=$(sha256sum < "$SOURCE/SHA256SUMS" | cut -c1-12)
RUNTIME="$BASE/host/$VERSION-$SUMS"
if [ ! -f "$RUNTIME/SHA256SUMS" ]; then
  TMP=$(mktemp -d "$BASE/host/.copy.XXXXXXXX")
  trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
  cp -R "$SOURCE/." "$TMP/"
  [ "$(sha256sum < "$TMP/SHA256SUMS" | cut -c1-12)" = "$SUMS" ] \
    || { echo 'The OmniCode installation changed during WSL setup. Retry the connection.'; exit 1; }
  (cd "$TMP" && sha256sum --quiet -c SHA256SUMS) \
    || { echo 'The WSL execution runtime failed verification. Reinstall OmniCode.'; exit 1; }
  chmod 755 "$TMP" "$TMP/bin" "$TMP/bin/node" "$TMP/bin/omnicode-control"
  chmod -R a-w "$TMP"
  mv "$TMP" "$RUNTIME"
  trap - EXIT
fi
for DIR in "$BASE/host"/*; do
  [ -d "$DIR" ] && [ "$DIR" != "$RUNTIME" ] || continue
  if ! cat /proc/[0-9]*/cmdline 2>/dev/null | tr '\0' '\n' \
    | USED="$DIR/" awk 'index($0, ENVIRON["USED"]) == 1 { found = 1 } END { exit !found }'; then
    chmod -R u+w "$DIR" && rm -rf "$DIR"
  fi
done
export PATH="$RUNTIME/bin:$HOME/.local/bin:$PATH"
"$RUNTIME/bin/node" "$RUNTIME/wsl-exec.mjs" prepare "$RUN" "$SOCKET" 9>&-
exec 9>&- 1>&3 3>&-
exec "$RUNTIME/bin/node" "$RUNTIME/wsl-exec.mjs" bridge "$RUN" "$SOCKET"
