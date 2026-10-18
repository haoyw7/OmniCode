import { expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerLaunch, resolveProvider } from "./process";

it.each(["cursor", "pi", "fx"] as const)(
  "does not execute an unrelated ambiguous %s binary while resolving providers",
  async (provider) => {
    const directory = mkdtempSync(
      join(tmpdir(), "monocode-provider-identity-"),
    );
    const name = provider === "cursor" ? "agent" : provider;
    const candidate = join(directory, name);
    const sentinel = join(directory, "executed");
    writeFileSync(candidate, `#!/bin/sh\nprintf bad > '${sentinel}'\n`);
    chmodSync(candidate, 0o755);
    vi.stubEnv("PATH", directory);
    try {
      let resolved: string | undefined;
      try {
        resolved = await resolveProvider(provider);
      } catch {
        /* no matching provider is expected on CI */
      }
      expect(resolved).not.toBe(candidate);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform !== "win32")(
  "recognizes a Cursor agent shim without executing it",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-cursor-identity-"));
    const targetDirectory = join(directory, "cursor-agent-package");
    const target = join(targetDirectory, "cursor-agent");
    const candidate = join(directory, "agent");
    const sentinel = join(directory, "executed");
    mkdirSync(targetDirectory);
    writeFileSync(target, `#!/bin/sh\nprintf bad > '${sentinel}'\n`);
    chmodSync(target, 0o755);
    symlinkSync(target, candidate);
    vi.stubEnv("PATH", directory);
    try {
      expect(await resolveProvider("cursor")).toBe(candidate);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === "win32")("resolves Pi's managed Windows launcher without executing its shell text", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-pi-managed-"));
  const bin = join(directory, "bin");
  const root = join(directory, "install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent");
  const entry = join(root, "dist/bundle/cli.js");
  mkdirSync(bin, { recursive: true }); mkdirSync(join(root, "dist/bundle"), { recursive: true });
  writeFileSync(join(directory, "install/current-version"), "1.3.0\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: "dist/bundle/cli.js" } }));
  writeFileSync(entry, "throw Error('Discovery must not execute this')");
  const shim = join(bin, "pi.cmd"); writeFileSync(shim, '@echo off\nnode "%~dp0pi-launcher.js" %*');
  vi.stubEnv("PATH", bin); vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    expect(await resolveProvider("pi")).toBe(shim);
    expect(await providerLaunch(shim, ["--version"])).toEqual({ command: process.execPath, args: [entry, "--version"] });
  } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
});

it.runIf(process.platform !== "win32")(
  "recognizes Pi's thin npm bin from its package manifest without executing it",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-pi-npm-identity-"));
    const packageDirectory = join(
      directory,
      "node_modules/@earendil-works/pi-coding-agent",
    );
    const target = join(packageDirectory, "dist/bundle/cli.js");
    const candidate = join(directory, "pi");
    const sentinel = join(directory, "executed");
    mkdirSync(join(packageDirectory, "dist/bundle"), { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-coding-agent",
        bin: { pi: "dist/bundle/cli.js" },
      }),
    );
    writeFileSync(target, `#!/bin/sh\nprintf bad > '${sentinel}'\n`);
    chmodSync(target, 0o755);
    symlinkSync(target, candidate);
    vi.stubEnv("PATH", directory);
    try {
      expect(await resolveProvider("pi")).toBe(candidate);
      expect(existsSync(sentinel)).toBe(false);
      writeFileSync(
        join(packageDirectory, "package.json"),
        JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          bin: { pi: "different-entry.js" },
        }),
      );
      await expect(resolveProvider("pi")).rejects.toThrow("not installed");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
