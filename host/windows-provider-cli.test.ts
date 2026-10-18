import { afterEach, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import script from "../src/platform/windows/desktop-provider-cli.ps1?raw";
import { resolveProvider } from "./process";
import * as desktop from "./windows-provider-cli";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "monocode desktop 中文-"));
  directories.push(root);
  const file = (relative: string) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Discovery must not execute this file");
    return path;
  };
  return { root, file };
}

async function discover(root: string, provider: "codex" | "claude", packageRoot?: string) {
  // Override only package enumeration; filesystem discovery uses real fixtures.
  const packageStub = packageRoot
    ? `function Get-AppxPackage { [pscustomobject]@{ InstallLocation = $env:MONOCODE_TEST_PACKAGE; Version = '1.0.0.0' } }`
    : "function Get-AppxPackage {}";
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const { stdout } = await promisify(execFile)(powershell, [
    "-NoProfile", "-NonInteractive", "-Command", `${packageStub}\n& {\n${script}\n} -Provider ${provider}`,
  ], { windowsHide: true, timeout: 10_000, encoding: "utf8", env: {
    ...process.env,
    LOCALAPPDATA: join(root, "Local"), APPDATA: join(root, "Roaming"),
    ProgramFiles: join(root, "Programs"), MONOCODE_TEST_PACKAGE: packageRoot,
  } });
  return stdout.trim();
}

it.runIf(process.platform === "win32")("finds a registered Codex MSIX payload outside the default install directory", async () => {
  const { root, file } = fixture();
  const cli = file("another drive/package/app/resources/codex.exe");
  file("another drive/package/app/Codex.exe");
  expect(await discover(root, "codex", join(root, "another drive/package"))).toBe(cli);
});

it.runIf(process.platform === "win32")("falls back from missing MSIX to a versioned classic Codex install", async () => {
  const { root, file } = fixture();
  file("Local/Codex/app-1.0.9/resources/codex.exe");
  const cli = file("Local/Codex/app-1.0.10/resources/codex.exe");
  expect(await discover(root, "codex")).toBe(cli);
});

it.runIf(process.platform === "win32")("finds an extracted Codex CLI without executing it", async () => {
  const { root, file } = fixture();
  const cli = file("Local/OpenAI/Codex/bin/hash/codex.exe");
  expect(await discover(root, "codex")).toBe(cli);
});

it.runIf(process.platform === "win32")("selects the newest complete Claude payload across classic and MSIX data", async () => {
  const { root, file } = fixture();
  file("Roaming/Claude/claude-code/2.1.99/hash/claude.exe");
  const cli = file("Local/Packages/Claude_publisher/LocalCache/Roaming/Claude/claude-code/2.1.100/hash/claude.exe");
  file("Roaming/Claude/claude-code/2.1.101/hash/claude.exe.download");
  file("Roaming/Claude/claude-code/not-a-version/claude.exe");
  expect(await discover(root, "claude")).toBe(cli);
});

it.runIf(process.platform === "win32")("does not mistake desktop launchers or missing installs for CLIs", async () => {
  const { root, file } = fixture();
  file("Local/Codex/Codex.exe");
  file("Local/Claude/claude.exe");
  expect(await discover(root, "codex")).toBe("");
  expect(await discover(root, "claude")).toBe("");
});

it.runIf(process.platform === "win32").each(["codex", "claude"] as const)(
  "prefers an independent %s CLI even when a desktop payload comes first on PATH", async (provider) => {
    const { root, file } = fixture();
    const bundled = file(provider === "codex"
      ? "Local/OpenAI/Codex/bin/hash/codex.exe"
      : "Roaming/Claude/claude-code/2.1.100/hash/claude.exe");
    const standalone = file(`standalone/${provider}.exe`);
    const probe = vi.spyOn(desktop, "resolveWindowsDesktopProvider");
    vi.stubEnv("PATH", [dirname(bundled), dirname(standalone)].join(delimiter));
    expect(await resolveProvider(provider)).toBe(standalone);
    expect(probe).not.toHaveBeenCalled();
  },
);

it.runIf(process.platform === "win32")("skips a GUI executable on PATH before selecting a CLI", async () => {
  const { root, file } = fixture();
  const gui = file("app/Codex.exe");
  file("app/resources/app.asar");
  const cli = file("standalone/codex.exe");
  vi.stubEnv("PATH", [dirname(gui), dirname(cli)].join(delimiter));
  expect(await resolveProvider("codex")).toBe(cli);
});
