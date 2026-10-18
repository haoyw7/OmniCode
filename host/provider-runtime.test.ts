import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureProviderRuntime, findManagedProviderRuntime, leaseProviderRuntime,
  parseProviderVersion, pruneProviderRuntimes, UnsupportedProviderRuntimeError,
  verifyProviderDependencyLock,
  type ProviderPlatform,
} from "./provider-runtime";
import { resolveProviderRuntime } from "./process";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "monocode-provider-runtime-")); directories.push(path); return path; }

interface Entry { path: string; content?: string; type?: string }
function archive(entries: Entry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100);
    header.write("0000755\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(entry.type ?? "0", 156);
    header.write("ustar\0", 257);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

function fixture(provider: "claude" | "codex", platform: ProviderPlatform, version = "1.2.3", entries?: Entry[]) {
  const mainName = provider === "claude" ? "@anthropic-ai/claude-code" : "@openai/codex";
  const packageName = provider === "claude" ? `${mainName}-${platform}` : mainName;
  const packageVersion = provider === "claude" ? version : `${version}-${platform}`;
  const windows = platform.startsWith("win32");
  const executable = provider === "claude" ? `claude${windows ? ".exe" : ""}`
    : `vendor/${windows ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-musl"}/bin/codex${windows ? ".exe" : ""}`;
  const tarball = archive(entries ?? [{ path: "package/" + executable, content: "native-artifact" }]);
  const integrity = "sha512-" + createHash("sha512").update(tarball).digest("base64");
  const packageUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(packageVersion)}`;
  const main = { name: mainName, version,
    optionalDependencies: { [`${mainName}-${platform}`]: provider === "claude" ? version : `npm:${mainName}@${packageVersion}` },
    dist: { integrity, tarball: "https://registry.npmjs.org/provider.tgz" },
  };
  const native = { name: packageName, version: packageVersion, dist: main.dist };
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith(".tgz")) return new Response(new Uint8Array(tarball));
    return Response.json(url === packageUrl ? native : main);
  });
  return { fetcher, tarball, native, main, executable, integrity };
}

describe("verified provider runtimes", () => {
  it.each([
    ["1.19.3", "linux-x64", "opencode-ai", "opencode-linux-x64-baseline"],
    ["1.19.3", "linux-arm64", "opencode-ai", "opencode-linux-arm64"],
    ["1.19.3", "win32-x64", "opencode-ai", "opencode-windows-x64-baseline"],
    ["2.0.32", "linux-x64", "@opencode/cli", "@opencode/cli-linux-x64-baseline"],
  ] as const)("pins OpenCode %s %s to its official native package without postinstall", async (version, platform, mainName, packageName) => {
    const root = await directory();
    const executable = `bin/opencode${platform.startsWith("win32") ? ".exe" : ""}`;
    const tarball = archive([{ path: `package/${executable}`, content: "native-opencode" }]);
    const dist = { integrity: "sha512-" + createHash("sha512").update(tarball).digest("base64"), tarball: "https://registry.npmjs.org/opencode.tgz" };
    const main = { name: mainName, version, optionalDependencies: { [packageName]: version }, dist };
    const native = { name: packageName, version, dist };
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith(".tgz") ? new Response(new Uint8Array(tarball))
      : Response.json(String(input).includes(encodeURIComponent(packageName) + "/") ? native : main));
    const artifact = await ensureProviderRuntime("opencode", version, platform, { root, fetch: fetcher });
    expect(artifact).toMatchObject({ provider: "opencode", packageName, packageVersion: version, entrypoint: executable, kind: "native" });
    expect(await readFile(artifact.command, "utf8")).toBe("native-opencode");
    expect((await findManagedProviderRuntime("opencode", platform, { root }))?.directory).toBe(artifact.directory);
  });

  it.each(["claude", "codex"] as const)("installs the official %s platform artifact and reuses its immutable directory", async (provider) => {
    const root = await directory();
    const data = fixture(provider, "linux-x64");
    const options = { root, fetch: data.fetcher, tarballMirror: "https://registry.npmmirror.com" };
    const [first, concurrent] = await Promise.all([
      ensureProviderRuntime(provider, "1.2.3", "linux-x64", options),
      ensureProviderRuntime(provider, "1.2.3", "linux-x64", options),
    ]);
    expect(concurrent.directory).toBe(first.directory);
    expect(await readFile(first.command, "utf8")).toBe("native-artifact");
    expect(first.files[0].sha256).toBe(createHash("sha256").update("native-artifact").digest("hex"));
    expect(first.entrypoint).toBe(data.executable);
    expect(data.fetcher.mock.calls.filter(([url]) => String(url).endsWith(".tgz"))).toHaveLength(1);
    expect(data.fetcher.mock.calls.filter(([url]) => !String(url).endsWith(".tgz")).every(([url]) => String(url).startsWith("https://registry.npmjs.org/"))).toBe(true);
    expect(data.fetcher.mock.calls.find(([url]) => String(url).endsWith(".tgz"))?.[0].toString()).toBe("https://registry.npmmirror.com/provider.tgz");
    expect((await findManagedProviderRuntime(provider, "linux-x64", { root }))?.directory).toBe(first.directory);
    await ensureProviderRuntime(provider, "1.2.3", "linux-x64", options);
    expect(data.fetcher.mock.calls.filter(([url]) => String(url).endsWith(".tgz"))).toHaveLength(1);
  });

  it("refuses a mirror's corrupt bytes before extracting any file", async () => {
    const root = await directory();
    const data = fixture("claude", "linux-x64");
    data.native.dist = { ...data.native.dist, integrity: "sha512-" + Buffer.alloc(64).toString("base64") };
    await expect(ensureProviderRuntime("claude", "1.2.3", "linux-x64", { root, fetch: data.fetcher })).rejects.toThrow("integrity mismatch");
    expect(await readdir(join(root, "claude", "linux-x64"))).toEqual([]);
  });

  it.each([
    { path: "package/../../escape" },
    { path: "package/C:/escape" },
    { path: "package/dir\\escape" },
    { path: "package/link", type: "2" },
    { path: "package/link", type: "1" },
    { path: "package/NUL" },
  ])("rejects unsafe archive entry $path ($type)", async (entry) => {
    const root = await directory();
    const data = fixture("claude", "linux-x64", "1.2.3", [entry]);
    await expect(ensureProviderRuntime("claude", "1.2.3", "linux-x64", { root, fetch: data.fetcher })).rejects.toThrow(/archive/);
    expect(await readdir(join(root, "claude", "linux-x64"))).toEqual([]);
  });

  it("rejects mismatched metadata and missing platform builds instead of substituting latest", async () => {
    const root = await directory();
    const data = fixture("codex", "linux-x64");
    data.native.version = "9.9.9-linux-x64";
    await expect(ensureProviderRuntime("codex", "1.2.3", "linux-x64", { root, fetch: data.fetcher })).rejects.toThrow("metadata");
    delete data.main.optionalDependencies["@openai/codex-linux-x64"];
    await expect(ensureProviderRuntime("codex", "1.2.3", "linux-x64", { root, fetch: data.fetcher })).rejects.toBeInstanceOf(UnsupportedProviderRuntimeError);
    await expect(ensureProviderRuntime("omp", "1.2.3", "linux-x64", { root, fetch: data.fetcher })).rejects.toBeInstanceOf(UnsupportedProviderRuntimeError);
  });

  it("retains active versions during cleanup, then removes them after release", async () => {
    const root = await directory();
    const data = fixture("claude", "linux-x64");
    const old = await ensureProviderRuntime("claude", "1.2.3", "linux-x64", { root, fetch: data.fetcher });
    const transfer = join(root, ".transfers", `claude-linux-x64-${basename(old.directory)}.tgz`);
    await mkdir(join(root, ".transfers"));
    await writeFile(transfer, "transfer");
    await writeFile(transfer + ".json", "{}");
    const update = fixture("claude", "linux-x64", "1.2.4");
    const latest = await ensureProviderRuntime("claude", "1.2.4", "linux-x64", { root, fetch: update.fetcher });
    const currentTransfer = join(root, ".transfers", `claude-linux-x64-${basename(latest.directory)}.tgz`);
    await writeFile(currentTransfer, "current-transfer");
    await writeFile(currentTransfer + ".json", "{}");
    const release = await leaseProviderRuntime(old);
    expect(await pruneProviderRuntimes("claude", "linux-x64", [latest.directory], { root })).toEqual([]);
    expect(await readFile(transfer, "utf8")).toBe("transfer");
    expect(await readFile(transfer + ".json", "utf8")).toBe("{}");
    await release(); await release();
    expect(await pruneProviderRuntimes("claude", "linux-x64", [latest.directory], { root })).toEqual([old.directory]);
    await expect(readFile(transfer)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(transfer + ".json")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(latest.command, "utf8")).toBe("native-artifact");
    expect(await readFile(currentTransfer, "utf8")).toBe("current-transfer");
    expect(await readFile(currentTransfer + ".json", "utf8")).toBe("{}");
  });

  it("uses the configured binary version and never fetches a different runtime", async () => {
    const root = await directory();
    const command = join(root, "custom-provider.mjs");
    await writeFile(command, "console.log('codex-cli 0.142.0');");
    const fetcher = vi.fn<typeof fetch>();
    const value = await resolveProviderRuntime("codex", { configuredPath: command, root, fetch: fetcher, installMissing: true });
    expect(value).toMatchObject({ command, version: "0.142.0", source: "configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not silently fall back when a configured binary is missing or reports no exact version", async () => {
    const root = await directory();
    const command = join(root, "bad-provider.mjs");
    await expect(resolveProviderRuntime("codex", { configuredPath: command, installMissing: true })).rejects.toThrow();
    await writeFile(command, "console.log('development');");
    await expect(resolveProviderRuntime("codex", { configuredPath: command, installMissing: true })).rejects.toThrow("exact version");
  });

  it("preserves prerelease versions reported by provider CLIs", () => {
    expect(parseProviderVersion("codex-cli 0.163.0-alpha.18.1\n")).toBe("0.163.0-alpha.18.1");
    expect(parseProviderVersion("2.1.302 (Claude Code)")).toBe("2.1.302");
    expect(() => parseProviderVersion("codex v1")).toThrow("exact version");
  });
});

it("verifies every pinned JavaScript dependency against official metadata before install", async () => {
  const integrity = "sha512-" + Buffer.alloc(64, 1).toString("base64");
  const value = { version: "1.2.3", resolved: "https://registry.npmjs.org/example/-/example-1.2.3.tgz", integrity };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ name: "example", version: "1.2.3", dist: { tarball: value.resolved, integrity } }));
  const lock = { lockfileVersion: 3, packages: { "": {}, "node_modules/example": value } };
  await verifyProviderDependencyLock(lock, fetcher);
  expect(fetcher.mock.calls[0][0]).toBe("https://registry.npmjs.org/example/1.2.3");
  await expect(verifyProviderDependencyLock({ ...lock, packages: { "node_modules/example": { ...value, integrity: "sha512-" + Buffer.alloc(64, 2).toString("base64") } } }, fetcher)).rejects.toThrow("official registry");
  await expect(verifyProviderDependencyLock({ ...lock, packages: { "node_modules/example": { ...value, link: true } } }, fetcher)).rejects.toThrow("verified registry");
});
