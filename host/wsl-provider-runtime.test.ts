import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ProviderRuntimeArtifact } from "./provider-runtime";
import { ensureWslProviderRuntime, type ProviderRuntimeRpc } from "./wsl-provider-runtime";
import { ensureProviderTransferArchive } from "./provider-runtime-transfer";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "monocode-wsl-runtime-")); directories.push(root);
  const home = join(root, "home"); await mkdir(home);
  const directory = join(root, "cache/claude/linux-x64/1.2.3-0123456789abcdef"); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "claude"), "fixture-native-artifact");
  if (process.platform !== "win32") await writeFile(join(root, "wslpath"), '#!/bin/sh\nprintf "%s" "$2"\n', { mode: 0o755 });
  const artifact: ProviderRuntimeArtifact = {
    provider: "claude", platform: "linux-x64", version: "1.2.3", directory,
    command: join(directory, "claude"), entrypoint: "claude", kind: "native",
    packageName: "fixture", packageVersion: "1.2.3", integrity: "fixture-integrity",
    files: [{ path: "claude", size: Buffer.byteLength("fixture-native-artifact"), sha256: createHash("sha256").update("fixture-native-artifact").digest("hex"), executable: true }],
  };
  const rpc: ProviderRuntimeRpc = { async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    if (op === "env.info") return { node: process.execPath, arch: "x64" } as T;
    if (op !== "exec") throw new Error("Unexpected operation");
    return new Promise((resolve, reject) => {
      const child = spawn(String(params.command), params.args as string[], {
        windowsHide: true, env: { ...process.env, HOME: home, USERPROFILE: home, PATH: root + delimiter + process.env.PATH },
      });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      child.once("error", reject);
      child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
      child.once("close", code => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() } as T));
      child.stdin.end(String(params.stdin));
    });
  } };
  return { root, home, artifact, rpc };
}

it("verifies transferred bytes and reuses the immutable Linux installation", async () => {
  const { artifact, rpc } = await fixture();
  const first = await ensureWslProviderRuntime(rpc, artifact);
  const before = await stat(first.command);
  expect(await readFile(first.command, "utf8")).toBe("fixture-native-artifact");
  const second = await ensureWslProviderRuntime(rpc, artifact);
  expect(second).toEqual(first);
  expect((await stat(first.command)).mtimeMs).toBe(before.mtimeMs);
});

it("rejects transfer checksum changes without publishing an installation", async () => {
  const { artifact, rpc, home } = await fixture();
  artifact.files[0].sha256 = "0".repeat(64);
  await expect(ensureWslProviderRuntime(rpc, artifact)).rejects.toThrow("checksum mismatch");
  await expect(stat(join(home, ".monocode/remote/providers/claude/1.2.3-0123456789abcdef"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects a manifest path that escapes the provider cache", async () => {
  const { artifact, rpc } = await fixture();
  artifact.files[0].path = "../outside";
  await expect(ensureWslProviderRuntime(rpc, artifact)).rejects.toThrow("Invalid provider file path");
});

it("transfers JavaScript dependency trees in one archive and preserves long paths and Node entrypoint", async () => {
  const { artifact, rpc } = await fixture();
  artifact.kind = "javascript";
  const dependency = `node_modules/${"long-package-name-".repeat(6)}/index.js`;
  await mkdir(join(artifact.directory, dependency, ".."), { recursive: true });
  await writeFile(join(artifact.directory, dependency), "export default 42;");
  artifact.files.push({ path: dependency, size: 18, sha256: createHash("sha256").update("export default 42;").digest("hex"), executable: false });
  const installed = await ensureWslProviderRuntime(rpc, artifact);
  expect(installed.command).toBe(process.execPath);
  expect(installed.args).toEqual([join(installed.directory, artifact.entrypoint)]);
  expect(await readFile(join(installed.directory, dependency), "utf8")).toBe("export default 42;");
  const before = await ensureProviderTransferArchive(artifact);
  expect(await ensureProviderTransferArchive(artifact)).toEqual(before);
});

it("rejects a corrupt archive before extracting or publishing it", async () => {
  const { artifact, rpc, home } = await fixture();
  artifact.kind = "javascript";
  const archive = await ensureProviderTransferArchive(artifact);
  const bytes = await readFile(archive.path); bytes[bytes.length - 1] ^= 1;
  await writeFile(archive.path, bytes);
  await expect(ensureWslProviderRuntime(rpc, artifact)).rejects.toThrow("archive checksum mismatch");
  await expect(stat(join(home, ".monocode/remote/providers/claude/1.2.3-0123456789abcdef"))).rejects.toMatchObject({ code: "ENOENT" });
});
