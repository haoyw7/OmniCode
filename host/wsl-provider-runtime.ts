import { retainProviderRuntime, type ProviderRuntimeArtifact } from "./provider-runtime";
import { ensureProviderTransferArchive } from "./provider-runtime-transfer";

export interface ProviderRuntimeRpc {
  request<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T>;
}

export interface WslProviderRuntime {
  command: string;
  args?: string[];
  directory: string;
  version: string;
  platform: string;
}
const retainedByConnection = new WeakMap<ProviderRuntimeRpc, Set<string>>();

// Runs in the execution service's bundled Node. argv/stdin are data; no shell is
// involved. Large files are copied once from the Windows cache, never as RPC frames.
const installScript = String.raw`
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const artifact = JSON.parse(input);
if (!['claude', 'codex', 'pi', 'opencode'].includes(artifact.provider) || !/^linux-(x64|arm64)$/.test(artifact.platform) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-f0-9]{16}$/.test(artifact.name)) throw new Error('Invalid provider artifact');
const source = process.platform === 'win32' ? artifact.directory : execFileSync('wslpath', ['-u', artifact.directory], { encoding: 'utf8' }).trim();
const parent = join(homedir(), '.monocode', 'remote', 'providers', artifact.provider);
const destination = join(parent, artifact.name);
const marker = '.monocode-runtime.json';
const identity = JSON.stringify({ provider: artifact.provider, version: artifact.version, platform: artifact.platform,
  integrity: artifact.integrity, entrypoint: artifact.entrypoint, files: artifact.files });
const safe = (root, relative) => {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
      relative.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f:]/.test(part))) throw new Error('Invalid provider file path');
  const value = resolve(root, ...relative.split('/'));
  if (!value.startsWith(resolve(root) + sep)) throw new Error('Provider path escaped installation');
  return value;
};
const valid = async () => {
  try {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error('Invalid provider installation');
    if (await readFile(join(destination, marker), 'utf8') !== identity) throw new Error('Provider installation identity mismatch');
    if (!(await lstat(safe(destination, artifact.entrypoint))).isFile()) throw new Error('Missing provider executable');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
if (!await valid()) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = join(parent, '.copy-' + randomUUID());
  await mkdir(staging, { mode: 0o700 });
  try {
    if (artifact.archive) {
      const archiveSource = process.platform === 'win32' ? artifact.archive.path : execFileSync('wslpath', ['-u', artifact.archive.path], { encoding: 'utf8' }).trim();
      const archive = join(staging, '.transfer.tgz');
      const info = await lstat(archiveSource);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.archive.size) throw new Error('Provider archive changed during transfer');
      await copyFile(archiveSource, archive);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(archive)) hash.update(chunk);
      if (hash.digest('hex') !== artifact.archive.sha256) throw new Error('Provider archive checksum mismatch');
      // This archive was generated from the verified manifest with no links or special entries.
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '-C', staging], { stdio: 'pipe' });
      await rm(archive);
    }
    for (const file of artifact.files) {
      const from = safe(source, file.path), to = safe(staging, file.path);
      if (!artifact.archive) {
        const info = await lstat(from);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error('Provider source changed during transfer');
        await mkdir(dirname(to), { recursive: true, mode: 0o700 });
        await copyFile(from, to);
      }
      const info = await lstat(to);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error('Provider transfer file mismatch');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(to)) hash.update(chunk);
      if (hash.digest('hex') !== file.sha256) throw new Error('Provider transfer checksum mismatch');
      await chmod(to, file.executable ? 0o755 : 0o644);
    }
    if (!(await lstat(safe(staging, artifact.entrypoint))).isFile()) throw new Error('Missing provider executable');
    await writeFile(join(staging, marker), identity, { flag: 'wx', mode: 0o600 });
    try { await rename(staging, destination); }
    catch (error) { if (!await valid()) throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.platform === 'linux') {
  const commands = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { commands.push(...(await readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0')); }
    catch { /* Exited processes and other users' protected commands cannot be inspected. */ }
  }
  const keep = new Set(artifact.keep ?? [artifact.name]);
  keep.add(artifact.name);
  for (const name of await readdir(parent)) {
    if (keep.has(name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-f0-9]{16}$/.test(name)) continue;
    const candidate = safe(parent, name);
    if (commands.some(command => command === candidate || command.startsWith(candidate + '/'))) continue;
    const info = await lstat(candidate);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    // A concurrent setup may have selected a directory but not spawned yet.
    if (Date.now() - info.mtimeMs < 60_000) continue;
    try { await readFile(join(candidate, marker), 'utf8'); }
    catch { continue; }
    await rm(candidate, { recursive: true, force: true });
  }
}
process.stdout.write(JSON.stringify({ directory: destination, command: safe(destination, artifact.entrypoint),
  version: artifact.version, platform: artifact.platform }));
`;

export async function ensureWslProviderRuntime(rpc: ProviderRuntimeRpc, artifact: ProviderRuntimeArtifact): Promise<WslProviderRuntime> {
  if (!artifact.platform.startsWith("linux-")) throw new Error("WSL requires a Linux provider artifact");
  const info = await rpc.request<{ node: string; arch: string }>("env.info");
  if (`linux-${info.arch}` !== artifact.platform) throw new Error("Provider runtime does not match the WSL architecture");
  // Copying reads the Windows cache too; another Host must not prune it mid-copy.
  await retainProviderRuntime(artifact);
  const archive = artifact.kind === "javascript" ? await ensureProviderTransferArchive(artifact) : undefined;
  const name = artifact.directory.replaceAll("\\", "/").split("/").at(-1);
  let retained = retainedByConnection.get(rpc);
  if (!retained) { retained = new Set(); retainedByConnection.set(rpc, retained); }
  retained.add(`${artifact.provider}/${name}`);
  const result = await rpc.request<{ code: number | null; stdout: string; stderr: string }>("exec", {
    command: info.node,
    args: ["--input-type=module", "-e", installScript],
    stdin: JSON.stringify({ ...artifact, archive, name, keep: [...retained].filter((path) => path.startsWith(`${artifact.provider}/`)).map((path) => path.slice(artifact.provider.length + 1)) }),
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.code !== 0) throw new Error(`WSL provider transfer failed: ${result.stderr.trim() || "execution stopped"}`);
  const value = JSON.parse(result.stdout) as WslProviderRuntime;
  if (value.version !== artifact.version || value.platform !== artifact.platform || typeof value.command !== "string" || typeof value.directory !== "string")
    throw new Error("Invalid WSL provider transfer result");
  return artifact.kind === "javascript" ? { ...value, command: info.node, args: [value.command] } : value;
}
