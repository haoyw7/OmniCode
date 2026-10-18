import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { promisify } from "node:util";

export type RuntimeProvider = "claude" | "codex" | "pi" | "opencode";
export type ProviderPlatform = "win32-x64" | "win32-arm64" | "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";

export interface ProviderRuntimeFile {
  path: string;
  sha256: string;
  size: number;
  executable: boolean;
}

export interface ProviderRuntimeArtifact {
  provider: RuntimeProvider;
  platform: ProviderPlatform;
  version: string;
  directory: string;
  command: string;
  entrypoint: string;
  kind: "native" | "javascript";
  packageName: string;
  packageVersion: string;
  integrity: string;
  /** Official dependency lock fingerprint for a complete JavaScript package tree. */
  dependencyLockSha256?: string;
  files: ProviderRuntimeFile[];
}

export interface ProviderRuntimeOptions {
  /** Provider cache, not the Host data directory. */
  root?: string;
  /** Tarballs may use a mirror; metadata always comes from registry.npmjs.org. */
  tarballMirror?: string;
  /** Injectable transport for deterministic offline tests. */
  fetch?: typeof globalThis.fetch;
}

export class UnsupportedProviderRuntimeError extends Error {
  constructor(provider: string, platform?: string) {
    super(`No managed ${platform ?? "platform"} runtime is available for ${provider}`);
    this.name = "UnsupportedProviderRuntimeError";
  }
}

const triples: Record<ProviderPlatform, string> = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

/** npm's platform packages are native artifacts, not the JS npm launchers. */
export const providerRuntimeDescriptors = {
  claude: { packageName: "@anthropic-ai/claude-code", kind: "native" },
  codex: { packageName: "@openai/codex", kind: "native" },
  pi: { packageName: "@earendil-works/pi-coding-agent", kind: "javascript" },
  opencode: { packageName: "opencode-ai", kind: "native" },
} as const;

export function providerRuntimePlatform(platform = process.platform, arch = process.arch): ProviderPlatform {
  const value = `${platform}-${arch}`;
  if (!(value in triples)) throw new UnsupportedProviderRuntimeError("provider", value);
  return value as ProviderPlatform;
}

export function supportsProviderRuntime(provider: string): provider is RuntimeProvider {
  return Object.hasOwn(providerRuntimeDescriptors, provider);
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const MANIFEST = ".monocode-runtime.json";
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 2 * MAX_ARCHIVE_BYTES;
const inFlight = new Map<string, Promise<ProviderRuntimeArtifact>>();
const retained = new Map<string, Promise<void>>();

export function providerRuntimeRoot(): string {
  return join(homedir(), ".monocode-host", "providers");
}

export function parseProviderVersion(output: string): string {
  const match = output.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)(?=\s|$|\))/);
  if (!match || !VERSION.test(match[1])) throw new Error("Provider did not report an exact version");
  return match[1];
}

function portablePath(path: string): string {
  const segments = path.split("/");
  if (!path || path.includes("\\") || segments.some((part) =>
    !part || part === "." || part === ".." || /[\x00-\x1f:<>"|?*]/.test(part) || /[ .]$/.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error("Unsafe provider archive path");
  return path;
}

function within(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(root, ...portablePath(path).split("/"));
  if (!target.startsWith(absoluteRoot + sep)) throw new Error("Provider path escaped its cache");
  return target;
}

interface PackageMetadata {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  dist: { integrity: string; tarball: string };
}

async function metadata(name: string, version: string, fetcher: typeof fetch): Promise<PackageMetadata> {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (response.status === 404) throw new UnsupportedProviderRuntimeError(name, version);
  if (!response.ok) throw new Error(`Provider metadata request failed (${response.status})`);
  const value = await response.json() as PackageMetadata;
  if (value.name !== name || !VERSION.test(value.version) || (version !== "latest" && value.version !== version) ||
    typeof value.dist?.integrity !== "string" || typeof value.dist.tarball !== "string")
    throw new Error("Invalid official provider package metadata");
  return value;
}

function integrityDigest(integrity: string): Buffer {
  const value = integrity.split(/\s+/).find((entry) => /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry));
  if (!value) throw new Error("Provider package requires official sha512 integrity");
  const digest = Buffer.from(value.slice("sha512-".length), "base64");
  if (digest.length !== 64) throw new Error("Invalid provider sha512 integrity");
  return digest;
}

async function download(metadata: PackageMetadata, destination: string, options: ProviderRuntimeOptions): Promise<void> {
  const url = new URL(metadata.dist.tarball);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid provider tarball URL");
  if (options.tarballMirror) {
    const mirror = new URL(options.tarballMirror);
    if (mirror.protocol !== "https:" || mirror.username || mirror.password || mirror.search || mirror.hash)
      throw new Error("Provider tarball mirror must use HTTPS");
    url.host = mirror.host;
    url.pathname = mirror.pathname.replace(/\/$/, "") + url.pathname;
  }
  const expected = integrityDigest(metadata.dist.integrity);
  const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`Provider download failed (${response.status})`);
  const hash = createHash("sha512");
  const file = await open(destination, "wx", 0o600);
  let size = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body as ReadableStream<Uint8Array>)) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) throw new Error("Provider archive exceeds size limit");
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (!timingSafeEqual(hash.digest(), expected)) throw new Error("Provider archive integrity mismatch");
  } finally {
    await file.close();
  }
}

/** A bounded streaming reader avoids holding 100–500 MB native packages in memory. */
class ArchiveReader {
  private chunk: Buffer = Buffer.alloc(0);
  private offset = 0;
  private readonly iterator: AsyncIterator<Buffer>;
  constructor(stream: AsyncIterable<Buffer>) { this.iterator = stream[Symbol.asyncIterator](); }
  async read(size: number): Promise<Buffer> {
    const result = Buffer.allocUnsafe(size);
    let written = 0;
    while (written < size) {
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) throw new Error("Truncated provider archive");
        this.chunk = next.value;
        this.offset = 0;
      }
      const length = Math.min(size - written, this.chunk.length - this.offset);
      this.chunk.copy(result, written, this.offset, this.offset + length);
      written += length;
      this.offset += length;
    }
    return result;
  }
}

function tarText(header: Buffer, start: number, length: number): string {
  return header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
}

function tarNumber(header: Buffer, start: number, length: number): number {
  const text = tarText(header, start, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error("Invalid provider archive header");
  const number = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid provider archive size");
  return number;
}

function paxPath(bytes: Buffer): string | undefined {
  let offset = 0;
  let path: string | undefined;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const count = Number(bytes.subarray(offset, space).toString("ascii"));
    if (space < offset || !Number.isSafeInteger(count) || count <= space - offset + 1 || offset + count > bytes.length)
      throw new Error("Invalid provider archive extended header");
    const record = bytes.subarray(space + 1, offset + count - 1).toString("utf8");
    if (record.startsWith("path=")) path = record.slice(5);
    // Do not permit metadata to silently turn a regular file into a link or sparse file.
    if (record.startsWith("linkpath=") || record.startsWith("GNU.sparse") || record.startsWith("size="))
      throw new Error("Unsupported provider archive extended header");
    offset += count;
  }
  return path;
}

async function extract(archive: string, destination: string): Promise<ProviderRuntimeFile[]> {
  const input = createReadStream(archive);
  const gunzip = input.pipe(createGunzip());
  input.on("error", (error) => gunzip.destroy(error));
  const reader = new ArchiveReader(gunzip);
  const files: ProviderRuntimeFile[] = [];
  const seen = new Set<string>();
  let extendedPath: string | undefined;
  let total = 0;
  try {
    while (true) {
      const header = await reader.read(512);
      if (header.every((byte) => byte === 0)) break;
      const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
      if (checksum !== tarNumber(header, 148, 8)) throw new Error("Invalid provider archive checksum");
      const size = tarNumber(header, 124, 12);
      total += size;
      if (total > MAX_UNPACKED_BYTES || files.length > 100_000) throw new Error("Provider archive exceeds extraction limit");
      const type = tarText(header, 156, 1);
      if (type === "x" || type === "L") {
        if (size > 64 * 1024) throw new Error("Provider archive extended header is too large");
        const value = await reader.read(size);
        extendedPath = type === "x" ? paxPath(value) : value.toString("utf8").replace(/\0.*$/s, "");
      } else {
        const prefix = tarText(header, 345, 155);
        const name = extendedPath ?? (prefix ? prefix + "/" : "") + tarText(header, 0, 100);
        extendedPath = undefined;
        if (type !== "0" && type !== "" && type !== "5") throw new Error("Provider archive links and special files are not allowed");
        if (!name.startsWith("package/")) throw new Error("Invalid provider archive package root");
        const relative = name.slice("package/".length).replace(/\/$/, "");
        if (relative) {
          const target = within(destination, relative);
          if (relative === MANIFEST) throw new Error("Reserved provider archive path");
          if (type === "5") {
            if (size) throw new Error("Invalid provider archive directory");
            await mkdir(target, { recursive: true });
          } else {
            if (seen.has(relative.toLowerCase())) throw new Error("Duplicate provider archive path");
            seen.add(relative.toLowerCase());
            await mkdir(dirname(target), { recursive: true });
            const mode = tarNumber(header, 100, 8);
            const executable = Boolean(mode & 0o111);
            const file = await open(target, "wx", executable ? 0o755 : 0o644);
            const hash = createHash("sha256");
            try {
              let remaining = size;
              while (remaining > 0) {
                const chunk = await reader.read(Math.min(remaining, 64 * 1024));
                hash.update(chunk);
                await file.writeFile(chunk);
                remaining -= chunk.length;
              }
            } finally { await file.close(); }
            files.push({ path: relative, sha256: hash.digest("hex"), size, executable });
          }
        } else if (type !== "5" || size) throw new Error("Invalid provider archive root entry");
      }
      const padding = (512 - size % 512) % 512;
      if (padding) await reader.read(padding);
    }
    if (!files.length) throw new Error("Empty provider archive");
    return files;
  } finally {
    input.destroy();
    gunzip.destroy();
  }
}

function runtimeIdentity(provider: RuntimeProvider, platform: ProviderPlatform, metadata: PackageMetadata, version: string, lockHash?: string) {
  const hash = createHash("sha256").update(metadata.dist.integrity + (lockHash ?? "")).digest("hex").slice(0, 16);
  const executable = platform.startsWith("win32-") ? ".exe" : "";
  return {
    name: `${version}-${hash}`,
    entrypoints: provider === "pi" ? [
      "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
      "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      "node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    ] : provider === "claude" ? [`claude${executable}`] : provider === "opencode" ? [`bin/opencode${executable}`] : [
      `vendor/${triples[platform]}/bin/codex${executable}`,
      `vendor/${triples[platform]}/codex/codex${executable}`,
    ],
  };
}

async function readArtifact(directory: string, provider: RuntimeProvider, platform: ProviderPlatform): Promise<ProviderRuntimeArtifact | undefined> {
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Provider cache must not be a symlink");
    const value = JSON.parse(await readFile(join(directory, MANIFEST), "utf8")) as ProviderRuntimeArtifact;
    if (value.provider !== provider || value.platform !== platform || !VERSION.test(value.version) || value.kind !== (provider === "pi" ? "javascript" : "native") ||
      !Array.isArray(value.files) || value.files.length === 0 || typeof value.integrity !== "string") throw new Error("Invalid provider runtime manifest");
    if (provider === "pi" && (!value.dependencyLockSha256 || !/^[a-f0-9]{64}$/.test(value.dependencyLockSha256) ||
        createHash("sha256").update(await readFile(join(directory, "package-lock.json"))).digest("hex") !== value.dependencyLockSha256))
      throw new Error("Invalid provider dependency lock");
    const expected = runtimeIdentity(provider, platform, { dist: { integrity: value.integrity } } as PackageMetadata, value.version, value.dependencyLockSha256);
    if (basename(directory) !== expected.name || !expected.entrypoints.includes(value.entrypoint)) throw new Error("Invalid provider runtime identity");
    integrityDigest(value.integrity);
    for (const file of value.files) {
      portablePath(file.path);
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0)
        throw new Error("Invalid provider file manifest");
    }
    const command = within(directory, value.entrypoint);
    const entry = await lstat(command);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Invalid provider runtime executable");
    return { ...value, directory: resolve(directory), command };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Reads only existing cache entries; ordinary provider discovery never downloads. */
export async function findManagedProviderRuntime(provider: string, platform = providerRuntimePlatform(), options: ProviderRuntimeOptions = {}): Promise<ProviderRuntimeArtifact | undefined> {
  if (!supportsProviderRuntime(provider)) return undefined;
  const root = join(options.root ?? providerRuntimeRoot(), provider, platform);
  let entries: string[];
  try { entries = await readdir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const artifacts: ProviderRuntimeArtifact[] = [];
  for (const name of entries) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-f0-9]{16}$/.test(name)) continue;
    const artifact = await readArtifact(join(root, name), provider, platform);
    if (artifact) artifacts.push(artifact);
  }
  artifacts.sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
  return artifacts[0];
}

/** Downloads and verifies an exact platform artifact without executing package scripts. */
export async function ensureProviderRuntime(provider: string, version: string, platform: ProviderPlatform, options: ProviderRuntimeOptions = {}): Promise<ProviderRuntimeArtifact> {
  if (!supportsProviderRuntime(provider) || !(platform in triples)) throw new UnsupportedProviderRuntimeError(provider, platform);
  if (version !== "latest" && !VERSION.test(version)) throw new Error("An exact provider version is required");
  const root = resolve(options.root ?? providerRuntimeRoot());
  const key = `${root}\0${provider}\0${version}\0${platform}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = install(provider, version, platform, { ...options, root });
  inFlight.set(key, operation);
  try { return await operation; } finally { inFlight.delete(key); }
}

async function install(provider: RuntimeProvider, version: string, platform: ProviderPlatform, options: ProviderRuntimeOptions): Promise<ProviderRuntimeArtifact> {
  if (provider === "pi") return installPi(version, platform, options);
  const fetcher = options.fetch ?? fetch;
  // OpenCode 2 moved to a new scope. Keep automatic installs on the adapter's
  // existing 1.x line, but honor an explicitly selected desktop 2.x version.
  if (provider === "opencode" && version !== "latest" && !/^[12]\./.test(version))
    throw new UnsupportedProviderRuntimeError(provider, `${platform} ${version}`);
  const mainName = provider === "opencode" && version.startsWith("2.") ? "@opencode/cli" : providerRuntimeDescriptors[provider].packageName;
  const main = await metadata(mainName, version, fetcher);
  const nativePlatform = platform.replace(/^win32-/, "windows-");
  const opencodeBase = `${mainName === "opencode-ai" ? "opencode" : mainName}-${nativePlatform}`;
  // Baseline x64 runs on CPUs without AVX2, including WSL's virtual CPU. This
  // avoids selecting a build based on the Windows Host's instruction set.
  const dependency = provider === "opencode"
    ? (platform.endsWith("-x64") && main.optionalDependencies?.[`${opencodeBase}-baseline`] === main.version ? `${opencodeBase}-baseline` : opencodeBase)
    : `${mainName}-${platform}`;
  // Read the official main package's exact dependency, including Codex's npm alias.
  const reference = main.optionalDependencies?.[dependency];
  let packageName: string;
  let packageVersion: string;
  if ((provider === "claude" || provider === "opencode") && reference === main.version) {
    packageName = dependency;
    packageVersion = main.version;
  } else if (provider === "codex" && reference === `npm:${mainName}@${main.version}-${platform}`) {
    packageName = mainName;
    packageVersion = `${main.version}-${platform}`;
  } else throw new UnsupportedProviderRuntimeError(provider, `${platform} ${main.version}`);
  const pkg = await metadata(packageName, packageVersion, fetcher);
  const identity = runtimeIdentity(provider, platform, pkg, main.version);
  const parent = join(options.root!, provider, platform);
  const destination = join(parent, identity.name);
  const cached = await readArtifact(destination, provider, platform);
  if (cached) return cached;
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.install-${randomUUID()}`);
  const archive = staging + ".tgz";
  await mkdir(staging);
  try {
    await download(pkg, archive, options);
    const files = await extract(archive, staging);
    const entry = identity.entrypoints.map((path) => files.find((file) => file.path === path)).find(Boolean);
    if (!entry) throw new Error("Provider package is missing its native executable");
    entry.executable = true;
    await chmod(within(staging, entry.path), 0o755);
    const artifact: ProviderRuntimeArtifact = {
      provider, platform, version: main.version, directory: destination,
      command: within(destination, entry.path), entrypoint: entry.path,
      kind: "native", packageName, packageVersion, integrity: pkg.dist.integrity, files,
    };
    await writeFile(join(staging, MANIFEST), JSON.stringify(artifact), { flag: "wx", mode: 0o600 });
    try { await rename(staging, destination); } catch (error) {
      // Another Host may finish the same immutable artifact concurrently.
      const winner = await readArtifact(destination, provider, platform);
      if (winner) return winner;
      throw error;
    }
    return artifact;
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

// npm ships its own dependency tree. Pin this tool independently of provider versions.
const NPM_TOOL_VERSION = "11.6.2";
async function verifiedNpm(root: string, options: ProviderRuntimeOptions): Promise<string> {
  const pkg = await metadata("npm", NPM_TOOL_VERSION, options.fetch ?? fetch);
  const hash = createHash("sha256").update(pkg.dist.integrity).digest("hex").slice(0, 16);
  const parent = join(root, ".tools", "npm");
  const destination = join(parent, `${NPM_TOOL_VERSION}-${hash}`);
  const command = join(destination, "bin/npm-cli.js");
  const valid = async () => {
    try { return !(await lstat(destination)).isSymbolicLink() && (await lstat(command)).isFile() &&
      await readFile(join(destination, ".verified-integrity"), "utf8") === pkg.dist.integrity; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  if (await valid()) return command;
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.install-${randomUUID()}`); const archive = staging + ".tgz";
  await mkdir(staging);
  try {
    await download(pkg, archive, options); await extract(archive, staging);
    await writeFile(join(staging, ".verified-integrity"), pkg.dist.integrity, { flag: "wx" });
    try { await rename(staging, destination); } catch (error) { if (!await valid()) throw error; }
    return command;
  } finally { await rm(archive, { force: true }); await rm(staging, { recursive: true, force: true }); }
}

type NpmLockEntry = { name?: string; version?: string; resolved?: string; integrity?: string; link?: boolean };
type NpmLock = { lockfileVersion: number; packages: Record<string, NpmLockEntry> };

/** Check npm's complete resolution before any dependency tree is installed. */
export async function verifyProviderDependencyLock(lock: NpmLock, fetcher: typeof fetch = fetch): Promise<void> {
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") throw new Error("Unsupported provider dependency lock");
  const entries = Object.entries(lock.packages).filter(([key]) => key !== "");
  if (entries.length > 1500) throw new Error("Provider dependency tree exceeds package limit");
  for (let offset = 0; offset < entries.length; offset += 8) await Promise.all(entries.slice(offset, offset + 8).map(async ([path, value]) => {
    portablePath(path);
    const marker = "node_modules/";
    if (!path.includes(marker) || value.link || !value.version || !value.integrity || !value.resolved)
      throw new Error("Provider dependency is not a verified registry package");
    const name = value.name ?? path.slice(path.lastIndexOf(marker) + marker.length);
    const official = await metadata(name, value.version, fetcher);
    integrityDigest(value.integrity);
    if (official.dist.integrity !== value.integrity || official.dist.tarball !== value.resolved)
      throw new Error("Provider dependency differs from official registry metadata");
  }));
}

async function hashPackageTree(root: string): Promise<ProviderRuntimeFile[]> {
  const result: ProviderRuntimeFile[] = []; let bytes = 0;
  const walk = async (relative: string) => {
    for (const entry of await readdir(relative ? within(root, relative) : root, { withFileTypes: true })) {
      const file = relative ? relative + "/" + entry.name : entry.name;
      const target = within(root, file);
      if (entry.isSymbolicLink()) throw new Error("Provider dependency links are not allowed");
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) throw new Error("Provider dependency contains a special file");
      const info = await lstat(target); bytes += info.size;
      if (bytes > MAX_UNPACKED_BYTES || result.length > 100_000) throw new Error("Provider dependency tree exceeds size limit");
      const hash = createHash("sha256"); let executable = Boolean(info.mode & 0o111); let first = true;
      for await (const chunk of createReadStream(target)) {
        if (first) { const prefix = chunk.subarray(0, 4); executable ||= prefix.equals(Buffer.from([127, 69, 76, 70])) || prefix.subarray(0, 2).toString() === "#!"; first = false; }
        hash.update(chunk);
      }
      result.push({ path: file, size: info.size, sha256: hash.digest("hex"), executable });
    }
  };
  await walk(""); return result;
}

async function installPi(version: string, platform: ProviderPlatform, options: ProviderRuntimeOptions): Promise<ProviderRuntimeArtifact> {
  const root = options.root!;
  const parent = join(root, "pi", platform);
  // A pinned dependency lock stays immutable even if transitive ranges move later.
  if (version !== "latest") {
    const entries = await readdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    for (const entry of entries) if (entry.startsWith(version + "-")) {
      const cached = await readArtifact(join(parent, entry), "pi", platform); if (cached?.version === version) return cached;
    }
  }
  const pkg = await metadata(version.startsWith("0.") ? "@mariozechner/pi-coding-agent" : providerRuntimeDescriptors.pi.packageName, version, options.fetch ?? fetch);
  if (version === "latest") return installPi(pkg.version, platform, options);
  const npm = await verifiedNpm(root, options);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.install-${randomUUID()}`); await mkdir(staging);
  const userConfig = join(staging, ".npmrc-user"); const globalConfig = join(staging, ".npmrc-global");
  const [os, cpu] = platform.split("-");
  const flags = ["--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--bin-links=false", "--install-links=false",
    `--os=${os}`, `--cpu=${cpu}`, "--registry=https://registry.npmjs.org", `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`,
    `--cache=${join(root, ".tools", "npm-cache")}`, "--progress=false"];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  try {
    await writeFile(userConfig, ""); await writeFile(globalConfig, "");
    await writeFile(join(staging, "package.json"), JSON.stringify({ name: "monocode-provider-runtime", version: "1.0.0", private: true, dependencies: { [pkg.name]: pkg.version } }));
    const runNpm = (args: string[]) => promisify(execFile)(process.execPath, [npm, ...args, ...flags], {
      cwd: staging, env, windowsHide: true, timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
    });
    await runNpm(["install", "--package-lock-only"]);
    const canonicalLock = await readFile(join(staging, "package-lock.json"), "utf8");
    const lock = JSON.parse(canonicalLock) as NpmLock;
    await verifyProviderDependencyLock(lock, options.fetch ?? fetch);
    if (options.tarballMirror) {
      const mirror = new URL(options.tarballMirror);
      if (mirror.protocol !== "https:" || mirror.username || mirror.password || mirror.search || mirror.hash) throw new Error("Provider tarball mirror must use HTTPS");
      for (const value of Object.values(lock.packages)) if (value.resolved) {
        const url = new URL(value.resolved); url.host = mirror.host; url.pathname = mirror.pathname.replace(/\/$/, "") + url.pathname; value.resolved = url.toString();
      }
      await writeFile(join(staging, "package-lock.json"), JSON.stringify(lock));
    }
    await runNpm(["ci"]);
    await writeFile(join(staging, "package-lock.json"), canonicalLock);
    await rm(userConfig); await rm(globalConfig);
    const dependencyLockSha256 = createHash("sha256").update(canonicalLock).digest("hex");
    const identity = runtimeIdentity("pi", platform, pkg, pkg.version, dependencyLockSha256);
    const destination = join(parent, identity.name);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
    const entrypoint = `node_modules/${pkg.name}/${bin}`;
    if (!identity.entrypoints.includes(entrypoint) || !(await lstat(within(staging, entrypoint))).isFile()) throw new Error("Unsupported Pi package entrypoint");
    const files = await hashPackageTree(staging);
    const artifact: ProviderRuntimeArtifact = { provider: "pi", platform, version: pkg.version, directory: destination,
      command: within(destination, entrypoint), entrypoint, kind: "javascript", packageName: pkg.name, packageVersion: pkg.version,
      integrity: pkg.dist.integrity, dependencyLockSha256, files };
    await writeFile(join(staging, MANIFEST), JSON.stringify(artifact), { flag: "wx", mode: 0o600 });
    try { await rename(staging, destination); } catch (error) { const winner = await readArtifact(destination, "pi", platform); if (winner) return winner; throw error; }
    return artifact;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function withRuntimeLock<T>(parent: string, work: () => Promise<T>): Promise<T> {
  await mkdir(parent, { recursive: true });
  const lock = within(parent, ".runtime-lock");
  const until = Date.now() + 30_000;
  while (true) {
    try { await mkdir(lock); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const pid = Number(await readFile(join(lock, "pid"), "utf8"));
        if (!processAlive(pid)) { await rm(lock, { recursive: true, force: true }); continue; }
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
        // A crash between mkdir and writing the owner must not strand the cache.
        const info = await lstat(lock).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > 60_000) { await rm(lock, { recursive: true, force: true }); continue; }
      }
      if (Date.now() >= until) throw new Error("Provider runtime cache is busy");
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid));
    return await work();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

/** Cross-Host lease. A live PID conservatively pins its runtime, even after PID reuse. */
export async function leaseProviderRuntime(artifact: ProviderRuntimeArtifact): Promise<() => Promise<void>> {
  const parent = dirname(resolve(artifact.directory));
  const lease = within(parent, `.leases/${randomUUID()}.json`);
  await withRuntimeLock(parent, async () => {
    if (!(await lstat(artifact.command)).isFile()) throw new Error("Provider runtime disappeared before launch");
    await mkdir(dirname(lease), { recursive: true });
    await writeFile(lease, JSON.stringify({ pid: process.pid, directory: basename(artifact.directory) }), { flag: "wx", mode: 0o600 });
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await withRuntimeLock(parent, () => rm(lease, { force: true }));
  };
}

/** Keep every selected runtime while this Host is alive, including supervised children. */
export async function retainProviderRuntime(artifact: ProviderRuntimeArtifact): Promise<void> {
  const key = resolve(artifact.directory);
  let pending = retained.get(key);
  if (!pending) {
    pending = leaseProviderRuntime(artifact).then(() => undefined);
    retained.set(key, pending);
    void pending.catch(() => retained.delete(key));
  }
  await pending;
  await pruneProviderRuntimes(artifact.provider, artifact.platform, [key], { root: dirname(dirname(dirname(key))) });
}

/** Removes unused immutable versions. Live Hosts and explicit keep paths pin entries. */
export async function pruneProviderRuntimes(provider: RuntimeProvider, platform: ProviderPlatform, keep: readonly string[], options: ProviderRuntimeOptions = {}): Promise<string[]> {
  const root = resolve(options.root ?? providerRuntimeRoot());
  const parent = join(root, provider, platform);
  const preserved = new Set(keep.map((path) => resolve(path)));
  const removed: string[] = [];
  return withRuntimeLock(parent, async () => {
    let leaseFiles: string[] = [];
    try { leaseFiles = await readdir(join(parent, ".leases")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of leaseFiles) {
      const leasePath = within(parent, `.leases/${name}`);
      const lease = JSON.parse(await readFile(leasePath, "utf8")) as { pid: number; directory: string };
      if (processAlive(lease.pid)) preserved.add(within(parent, lease.directory));
      else await rm(leasePath, { force: true });
    }
    for (const name of await readdir(parent)) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-f0-9]{16}$/.test(name)) continue;
      const directory = within(parent, name);
      if (preserved.has(directory)) continue;
      const artifact = await readArtifact(directory, provider, platform);
      if (!artifact) continue;
      await rm(directory, { recursive: true, force: true });
      const transfer = join(root, ".transfers", `${provider}-${platform}-${name}.tgz`);
      await rm(transfer, { force: true });
      await rm(transfer + ".json", { force: true });
      removed.push(directory);
    }
    return removed;
  });
}
