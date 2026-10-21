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
printf '%s\n' '{"startup":{"stage":"checking-runtime"}}' >&3
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
  # The bundled Node streams copy progress; verify it before executing from the source.
  (cd "$SOURCE" && sha256sum --quiet -c SHA256SUMS) \
    || { echo 'The WSL execution runtime failed verification. Reinstall OmniCode.'; exit 1; }
  "$SOURCE/bin/node" --input-type=module - "$SOURCE" "$TMP" >&3 <<'OMNICODE_COPY_JS'
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const [source, destination] = process.argv.slice(2), files = [];
async function walk(path = '') {
  for (const entry of await readdir(join(source, path), { withFileTypes: true })) {
    const relative = join(path, entry.name);
    if (entry.isDirectory()) await walk(relative);
    else if (entry.isFile()) files.push({ path: relative, size: (await stat(join(source, relative))).size });
    else throw new Error('Invalid WSL runtime file');
  }
}
await walk();
const total = files.reduce((sum, file) => sum + file.size, 0);
let completed = 0, last = 0;
function progress() {
  const now = Date.now();
  if (last && now - last < 250 && completed !== total) return;
  last = now;
  process.stdout.write(JSON.stringify({ startup: { stage: 'copying-runtime', completed, total, unit: 'bytes' } }) + '\n');
}
progress();
for (const file of files) {
  const target = join(destination, file.path);
  await mkdir(dirname(target), { recursive: true });
  await pipeline(createReadStream(join(source, file.path)), new Transform({ transform(chunk, encoding, done) {
    completed += chunk.length; progress(); done(null, chunk);
  } }), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}
OMNICODE_COPY_JS
  printf '%s\n' '{"startup":{"stage":"checking-runtime"}}' >&3
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
printf '%s\n' '{"startup":{"stage":"connecting-wsl"}}' >&3
"$RUNTIME/bin/node" "$RUNTIME/wsl-exec.mjs" prepare "$RUN" "$SOCKET" 9>&-
exec 9>&- 1>&3 3>&-
exec "$RUNTIME/bin/node" "$RUNTIME/wsl-exec.mjs" bridge "$RUN" "$SOCKET"
