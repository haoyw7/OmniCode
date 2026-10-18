import { expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostChildBackend } from "./child-backend";
import { REMOTE_PROVIDERS } from "../src/features/connections/model/protocol";

it.each(["codex", "pi", "omp"] as const)(
  "uses the desktop's configured %s CLI for discovery and execution without falling back",
  async (provider) => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-desktop-cli-"));
    const config = join(directory, "desktop-owner.json");
    const file = join(directory, "custom-cli.cjs");
    writeFileSync(file, "console.log('configured-cli 1.0');");
    const publish = (path: string) => writeFileSync(config, JSON.stringify({
      desktopDirectory: directory, providerBinaryPaths: { [provider]: path },
    }));
    publish(file);
    const backend = new HostChildBackend({}, config);
    try {
      await expect(backend.invoke(`harness_resolve_${provider}`)).resolves.toEqual({ path: file });
      await expect(backend.invoke("harness_exec", {
        binaryProvider: provider, command: file, args: ["--version"],
      })).resolves.toContain("configured-cli 1.0");
      publish(join(directory, "missing.exe"));
      await expect(backend.resolve(provider)).rejects.toThrow();
      publish("relative.exe");
      await expect(backend.resolve(provider)).rejects.toThrow("Invalid configured");
      writeFileSync(config, JSON.stringify({ providerBinaryPaths: [] }));
      await expect(backend.resolve(provider)).rejects.toThrow("Invalid desktop CLI");
    } finally {
      await backend.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["codex", "claude"])(
  "uses the existing desktop named %s account without inherited API credentials",
  async (provider) => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-shared-account-"));
    const config = join(directory, "desktop-owner.json");
    writeFileSync(config, JSON.stringify({ desktopDirectory: directory }));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `console.log(JSON.stringify({ home: process.env.CODEX_HOME,
    claude: process.env.CLAUDE_CONFIG_DIR, secure: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
    inherited: ${provider === "codex" ? "!!process.env.OPENAI_API_KEY" : "!!process.env.ANTHROPIC_API_KEY"} }));`,
    );
    mkdirSync(join(directory, "provider-accounts", provider, "saved"), { recursive: true });
    const backend = new HostChildBackend({}, config);
    let received: any;
    const release = await backend.listen<{ line: string }>(
      "harness-stdout",
      ({ payload }) => {
        received = JSON.parse(payload.line);
      },
    );
    vi.stubEnv(
      provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
      "fixture-only",
    );
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "account-test",
        command: file,
        args: [],
        cwd: directory,
        account: { provider, id: "saved" },
      });
      await vi.waitFor(() => expect(received).toBeDefined());
      const profile = join(directory, "provider-accounts", provider, "saved");
      expect(provider === "codex" ? received.home : received.claude).toBe(
        profile,
      );
      if (provider === "claude") expect(received.secure).toBe(profile);
      expect(received.inherited).toBe(false);
      rmSync(profile, { recursive: true });
      await expect(backend.invoke("harness_spawn", {
        sessionId: "removed", command: file, args: [], cwd: directory,
        account: { provider, id: "saved" },
      })).rejects.toThrow("This provider account is no longer available");
      expect(existsSync(profile)).toBe(false);
      await expect(
        backend.invoke("harness_spawn", {
          sessionId: "invalid",
          command: file,
          args: [],
          cwd: directory,
          account: { provider, id: "../../outside" },
        }),
      ).rejects.toThrow("Invalid provider account");
    } finally {
      release();
      await backend.close();
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["codex", "claude"].flatMap(provider => ["work", "default"].map(accountId => [provider, accountId])))("runs %s profile %s with a configured external Home without copying credentials", async (provider, accountId) => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-custom-home-"));
  const home = join(directory, "external home");
  const profiles = join(directory, "provider-accounts");
  mkdirSync(home); mkdirSync(profiles);
  writeFileSync(join(home, "credentials"), "keep");
  writeFileSync(join(profiles, "accounts.json"), JSON.stringify({ [provider]: [{ id: accountId, label: "Work", dataHome: home }] }));
  const config = join(directory, "desktop.json");
  writeFileSync(config, JSON.stringify({ desktopDirectory: directory }));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, `console.log(JSON.stringify({home: process.env.${provider === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"}, secure: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, token: process.env.${provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}}))`);
  const backend = new HostChildBackend({}, config);
  let received: { home?: string; secure?: string; token?: string } | undefined;
  const release = await backend.listen<{ line: string }>("harness-stdout", ({ payload }) => { received = JSON.parse(payload.line); });
  vi.stubEnv(provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY", "inherited");
  try {
    await backend.invoke("harness_spawn", { sessionId: "custom", command: file, args: [], cwd: directory, account: { provider, id: accountId } });
    await vi.waitFor(() => expect(received?.home).toBe(home));
    if (provider === "claude") expect(received?.secure).toBe(home);
    expect(received?.token).toBeUndefined();
    expect(readFileSync(join(home, "credentials"), "utf8")).toBe("keep");
    expect(existsSync(join(profiles, provider, accountId))).toBe(false);
    if (accountId === "default") {
      received = undefined;
      await backend.invoke("harness_spawn", { sessionId: "implicit", command: file, args: [], cwd: directory, binaryProvider: provider });
      await vi.waitFor(() => expect(received?.home).toBe(home));
      expect(received?.token).toBeUndefined();
    }
    rmSync(home, { recursive: true });
    await expect(backend.invoke("harness_spawn", { sessionId: "missing", command: file, args: [], cwd: directory, account: { provider, id: accountId } })).rejects.toThrow("no longer available");
    expect(existsSync(home)).toBe(false);
  } finally {
    release(); await backend.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});

it("resolves every provider and runs only allowed provider commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-catalog-test-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log(JSON.stringify(process.argv.slice(2)))");
  const backend = new HostChildBackend(
    Object.fromEntries(REMOTE_PROVIDERS.map((provider) => [provider, file])),
  );
  try {
    for (const provider of REMOTE_PROVIDERS) {
      const resolved = await backend.invoke<{ path: string; args?: string[] }>(
        `harness_resolve_${provider}`,
      );
      expect(resolved.path).toBe(file);
      if (provider === "antigravity")
        expect(resolved.args).toEqual(
          process.platform === "linux" ? ["--uid="] : [],
        );
    }
    const output = await backend.invoke<string>("harness_exec", {
      command: file,
      args: ["models", "--json"],
      binaryProvider: "fx",
      cwd: directory,
    });
    expect(JSON.parse(output)).toEqual(["models", "--json"]);
    const cleanupArgs = [
      "--no-auto-update",
      "sessions",
      "delete",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    const cleanupOutput = await backend.invoke<string>("harness_exec", {
      command: file,
      args: cleanupArgs,
      binaryProvider: "grok",
      cwd: directory,
    });
    expect(JSON.parse(cleanupOutput)).toEqual(cleanupArgs);
    for (const [provider, rejectedArgs] of [
      ["cursor", cleanupArgs],
      ["opencode", cleanupArgs],
      ["grok", ["--no-auto-update", "sessions", "delete", "--all"]],
      ["grok", ["--no-auto-update", "sessions", "delete", "../sessions"]],
      ["grok", ["--no-auto-update", "sessions", "delete", "invalid"]],
      ["grok", ["--no-auto-update sessions delete", cleanupArgs[3]]],
      ["grok", [...cleanupArgs, "--all"]],
    ] as const) {
      await expect(
        backend.invoke("harness_exec", {
          command: file,
          args: rejectedArgs,
          binaryProvider: provider,
          cwd: directory,
        }),
      ).rejects.toThrow("Unsupported headless catalog command");
    }
    await expect(
      backend.invoke("harness_exec", {
        command: file,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "fx",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
    writeFileSync(join(directory, "note.txt"), "host-owned transcript");
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "note.txt"),
      }),
    ).toBe("host-owned transcript");
    const transcript = "x".repeat(1024 * 1024 + 1);
    writeFileSync(join(directory, "large-transcript.txt"), transcript);
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "large-transcript.txt"),
      }),
    ).toBe(transcript);
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("bridges OpenCode HTTP and event streams on loopback", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"type":"ready"}\n\n');
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  const backend = new HostChildBackend();
  const events: string[] = [];
  const unlisten = await backend.listen<{ data: string }>(
    "harness-sse",
    ({ payload }) => events.push(payload.data),
  );
  try {
    const base = `http://127.0.0.1:${address.port}`;
    expect(
      await backend.invoke("harness_http", { url: base, method: "GET" }),
    ).toEqual({ status: 200, body: '{"ok":true}' });
    await backend.invoke("harness_sse_open", {
      sessionId: "fixture",
      url: `${base}/event`,
    });
    await vi.waitFor(() => expect(events).toEqual(['{"type":"ready"}']));
    await backend.invoke("harness_sse_close", { sessionId: "fixture" });
    await expect(
      backend.invoke("harness_http", {
        url: "https://example.com/",
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
  } finally {
    unlisten();
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("runs the resolved Claude version fallback in headless mode", async () => {
  const backend = new HostChildBackend({ claude: process.execPath });
  try {
    const version = await backend.invoke<string>("harness_exec", {
      command: process.execPath,
      args: ["--version"],
      binaryProvider: "claude",
      cwd: process.cwd(),
    });
    expect(version.trim()).toBe(process.version);
    await expect(
      backend.invoke("harness_exec", {
        command: process.execPath,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "claude",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
  } finally {
    await backend.close();
  }
});

it.each([false, true])(
  "stops a provider tree (ignores SIGTERM: %s)",
  async (stubborn) => {
    const directory = mkdtempSync(join(tmpdir(), "monocode-provider-tree-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(`${stubborn ? "process.on('SIGTERM', () => {});" : ""} console.log('ready'); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => console.log(JSON.stringify({ child: child.pid })));
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend();
    let descendant: number | undefined;
    const stopListening = await backend.listen<{ line: string }>(
      "harness-stdout",
      ({ payload }) => {
        descendant = JSON.parse(payload.line).child;
      },
    );
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "tree",
        command: file,
        args: [],
        cwd: directory,
      });
      await vi.waitFor(() => expect(descendant).toBeTruthy());
      await backend.kill("tree");
      await vi.waitFor(
        () => expect(() => process.kill(descendant!, 0)).toThrow(),
        { timeout: 5000 },
      );
    } finally {
      stopListening();
      await backend.close();
      if (descendant) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

it.each([0, 1])("reports provider exit %s while the host stays alive", async (code) => {
  vi.stubEnv("MONOCODE_PROVIDER_SUPERVISOR", "node");
  const directory = mkdtempSync(join(tmpdir(), "monocode-provider-exit-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, `console.log('provider output'); console.error('provider diagnostic'); process.exitCode = ${code};`);
  const backend = new HostChildBackend();
  const output: string[] = [];
  const diagnostics: string[] = [];
  let exit: { sessionId: string; code: number | null } | undefined;
  const releases = await Promise.all([
    backend.listen<{ line: string }>("harness-stdout", ({ payload }) => output.push(payload.line)),
    backend.listen<{ line: string }>("harness-stderr", ({ payload }) => diagnostics.push(payload.line)),
    backend.listen<{ sessionId: string; code: number | null }>("harness-exit", ({ payload }) => { exit = payload; }),
  ]);
  try {
    await backend.invoke("harness_spawn", { sessionId: "natural-exit", command: file, args: [], cwd: directory });
    await vi.waitFor(() => expect(exit).toMatchObject({ sessionId: "natural-exit", code }), { timeout: 5_000 });
    expect(output).toEqual(["provider output"]);
    expect(diagnostics).toEqual(["provider diagnostic"]);
  } finally {
    releases.forEach((release) => release());
    await backend.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("stops a provider tree when its host IPC disconnects unexpectedly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-provider-crash-"));
  const treeFile = join(directory, "tree.json");
  const providerFile = join(directory, "provider.cjs");
  writeFileSync(
    providerFile,
    `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(treeFile)}, JSON.stringify({ provider: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`,
  );
  const guard = spawn(
    process.execPath,
    [resolve("host/provider-guard.mjs"), process.execPath, providerFile],
    {
      cwd: directory,
      stdio: ["pipe", "ignore", "ignore", "ipc"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  let guardExited = false;
  guard.once("exit", () => {
    guardExited = true;
  });
  let tree: { provider: number; descendant: number } | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(treeFile)).toBe(true));
    tree = JSON.parse(readFileSync(treeFile, "utf8"));
    guard.disconnect();
    await vi.waitFor(
      () => {
        expect(() => process.kill(tree!.provider, 0)).toThrow();
        expect(() => process.kill(tree!.descendant, 0)).toThrow();
      },
      { timeout: 5_000 },
    );
    // The guard's cwd keeps this directory locked on Windows until it exits.
    await vi.waitFor(() => expect(guardExited).toBe(true), { timeout: 5_000 });
  } finally {
    if (guard.connected) guard.disconnect();
    guard.kill("SIGKILL");
    for (const pid of [tree?.provider, tree?.descendant]) {
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
    }
    await vi.waitFor(() => expect(guardExited).toBe(true), { timeout: 5_000 });
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}, 10_000);
