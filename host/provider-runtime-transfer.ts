import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { ProviderRuntimeArtifact } from "./provider-runtime";

export interface ProviderTransferArchive { path: string; sha256: string; size: number }
const pending = new Map<string, Promise<ProviderTransferArchive>>();

function header(path: string, size: number, mode: number, type = "0"): Buffer {
  const value = Buffer.alloc(512);
  value.write(path, 0, 100);
  const octal = (n: number, offset: number, length: number) => value.write(n.toString(8).padStart(length - 1, "0") + "\0", offset, length);
  octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
  value.fill(32, 148, 156); value.write(type, 156); value.write("ustar\0", 257); value.write("00", 263);
  value.write([...value].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return value;
}

async function* tarFiles(artifact: ProviderRuntimeArtifact): AsyncGenerator<Buffer> {
  for (const file of artifact.files) {
    if (!file.path || file.path.includes("\\") || file.path.split("/").some((part) => !part || part === "." || part === ".." || /[\x00-\x1f:]/.test(part)))
      throw new Error("Invalid provider transfer path");
    const source = resolve(artifact.directory, ...file.path.split("/"));
    if (!source.startsWith(resolve(artifact.directory) + sep)) throw new Error("Invalid provider transfer path");
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error("Provider source changed before transfer");
    const path = "package/" + file.path;
    if (Buffer.byteLength(path) > 100) {
      const name = Buffer.from(path + "\0");
      yield header("././@LongLink", name.length, 0o644, "L");
      yield name;
      if (name.length % 512) yield Buffer.alloc(512 - name.length % 512);
    }
    yield header(Buffer.byteLength(path) > 100 ? "package/long-name" : path, file.size, file.executable ? 0o755 : 0o644);
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(source)) {
      size += chunk.length; hash.update(chunk); yield chunk;
    }
    if (size !== file.size || hash.digest("hex") !== file.sha256) throw new Error("Provider source changed while archiving");
    if (size % 512) yield Buffer.alloc(512 - size % 512);
  }
  yield Buffer.alloc(1024);
}

/** A sidecar keeps the provider tree immutable and amortizes 9P transfer for JS dependencies. */
export function ensureProviderTransferArchive(artifact: ProviderRuntimeArtifact): Promise<ProviderTransferArchive> {
  const root = join(dirname(dirname(dirname(artifact.directory))), ".transfers");
  const path = join(root, `${artifact.provider}-${artifact.platform}-${basename(artifact.directory)}.tgz`);
  const existing = pending.get(path);
  if (existing) return existing;
  const operation = (async () => {
    const identity = createHash("sha256").update(JSON.stringify(artifact.files)).digest("hex");
    try {
      const cached = JSON.parse(await readFile(path + ".json", "utf8"));
      const info = await lstat(path);
      if (cached.identity === identity && /^[a-f0-9]{64}$/.test(cached.sha256) && cached.size === info.size && info.isFile() && !info.isSymbolicLink())
        return { path, sha256: cached.sha256 as string, size: info.size };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const staging = join(root, `.archive-${randomUUID()}`);
    try {
      await pipeline(Readable.from(tarFiles(artifact)), createGzip(), createWriteStream(staging, { flags: "wx", mode: 0o600 }));
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(staging)) hash.update(chunk);
      const result = { path, sha256: hash.digest("hex"), size: (await lstat(staging)).size };
      await rename(staging, path);
      await writeFile(staging + ".json", JSON.stringify({ ...result, identity }), { flag: "wx", mode: 0o600 });
      await rename(staging + ".json", path + ".json");
      return result;
    } finally { await rm(staging, { force: true }); await rm(staging + ".json", { force: true }); }
  })();
  pending.set(path, operation);
  void operation.finally(() => pending.delete(path)).catch(() => {});
  return operation;
}
