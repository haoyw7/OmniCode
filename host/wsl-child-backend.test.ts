import { expect, it, vi } from "vitest";
import { WslChildBackend } from "./wsl-child-backend";
import { currentMachineIO, WslMachineIO } from "./machine-io";
import type { WslExecutionEvent } from "./machines/wsl";
import { HostStore } from "./store";
import { checkoutResources, initCheckoutGuards } from "./checkout-guards";
import { wslProviderConfiguration } from "./wsl-provider-config";
import { refreshCodexAccountBeforeWsl } from "./provider-account-refresh";
import { wslSharedProviderEnvironment } from "./wsl-provider-environment";
import * as providerProcess from "./process";
import * as providerRuntime from "./provider-runtime";
import * as wslProviderRuntime from "./wsl-provider-runtime";

vi.mock("./provider-account-refresh", () => ({ refreshCodexAccountBeforeWsl: vi.fn(async () => "not-needed") }));
vi.mock("./wsl-provider-environment", async importOriginal => ({
  ...await importOriginal<typeof import("./wsl-provider-environment")>(),
  wslSharedProviderEnvironment: vi.fn(async () => ({})),
}));
vi.mock("./wsl-provider-config", async importOriginal => ({
  ...await importOriginal<typeof import("./wsl-provider-config")>(),
  wslProviderConfiguration: vi.fn(async () => ({ args: ["app-server"], home: "C:\\account", env: { CODEX_HOME: "/mnt/c/account", OPENAI_API_KEY: null }, warnings: [] })),
}));

it("resolves the matching Linux provider runtime without an opt-in flag", async () => {
  vi.stubEnv("MONOCODE_WSL_SHARED_HOST", undefined);
  const desktop = vi.spyOn(providerProcess, "resolveProviderRuntime").mockResolvedValue({
    provider: "codex", command: "C:\\codex.exe", version: "1.2.3", source: "configured", platform: "win32-x64",
  });
  const artifact: providerRuntime.ProviderRuntimeArtifact = {
    provider: "codex", platform: "linux-x64", version: "1.2.3", directory: "C:/cache/codex",
    command: "codex", entrypoint: "codex", kind: "native", packageName: "@openai/codex",
    packageVersion: "1.2.3", integrity: "test", files: [],
  };
  const download = vi.spyOn(providerRuntime, "ensureProviderRuntime").mockResolvedValue(artifact);
  const install = vi.spyOn(wslProviderRuntime, "ensureWslProviderRuntime").mockResolvedValue({
    command: "/runtime/codex", directory: "/runtime", version: "1.2.3", platform: "linux-x64",
  });
  const request = vi.fn(async () => ({ arch: "x64" })), resolve = vi.fn(async () => "C:\\codex.exe");
  const rpc = { request: request as <T>() => Promise<T>, onEvent: () => () => {}, isConnected: () => false };
  const backend = new WslChildBackend(rpc, new WslMachineIO("Ubuntu", rpc), { resolve }, "owner.json");
  try {
    await expect(backend.invoke("harness_resolve_codex")).resolves.toMatchObject({ path: "/runtime/codex" });
    expect(resolve).toHaveBeenCalledWith("codex");
    expect(desktop).toHaveBeenCalledWith("codex", { configuredPath: "C:\\codex.exe" });
    expect(request).toHaveBeenCalledWith("env.info");
    expect(download).toHaveBeenCalledWith("codex", "1.2.3", "linux-x64");
    expect(install).toHaveBeenCalledWith(rpc, artifact);
  } finally {
    await backend.close();
    desktop.mockRestore(); download.mockRestore(); install.mockRestore(); vi.unstubAllEnvs();
  }
});

function fixture(quickExit = false, store?: HostStore, environment: Record<string, string> = {}, resolve?: () => Promise<{ command: string; args?: string[]; fallback?: boolean }>) {
  let event!: (event: WslExecutionEvent) => void;
  const request = vi.fn(async (op: string, _params?: Record<string, unknown>): Promise<unknown> => {
    if (op === "process.spawn") {
      event({ stream: "session", kind: "stdout", data: '{"reply":"hello"}' });
      if (quickExit) event({ stream: "session", kind: "exit", data: { pid: 72, code: 0 } });
      return { pid: 72 };
    }
    if (op === "exec") return { stdout: "1.0.0", stderr: "", code: 0 };
    return null;
  });
  const rpc = { request: request as <T>(op: string, params?: Record<string, unknown>) => Promise<T>, onEvent: (listener: typeof event) => { event = listener; return vi.fn(); } };
  const backend = new WslChildBackend(rpc, new WslMachineIO("Ubuntu", rpc), { resolve: async () => "C:\\codex.exe" }, "owner.json", vi.fn(), resolve ?? (async () => ({ command: "/opt/provider", fallback: true })), () => environment, store);
  return { backend, request, event: (value: WslExecutionEvent) => event(value) };
}

it.each(["pi"])("routes %s through Linux process IO and retains the event machine context", async provider => {
  const f = fixture(); const output = vi.fn(() => expect(currentMachineIO().key).toBe("wsl:Ubuntu"));
  await f.backend.listen("harness-stdout", output);
  expect(await f.backend.invoke("harness_resolve_" + provider)).toEqual({ path: "/opt/provider" });
  expect(await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: ["--mode", "rpc"], cwd: "/repo", binaryProvider: provider })).toBe(72);
  expect(output).toHaveBeenCalledWith({ payload: { sessionId: "session", line: '{"reply":"hello"}' } });
  await f.backend.invoke("harness_write", { sessionId: "session", line: "input" });
  expect(f.request).toHaveBeenLastCalledWith("process.write", { stream: "session", data: "input\n" });
  await f.backend.invoke("harness_kill", { sessionId: "session" });
  expect(f.request).toHaveBeenLastCalledWith("process.kill", { stream: "session" });
  await f.backend.close();
});

it.each(["omp", "cursor", "grok", "fx", "hermes", "antigravity"])("blocks %s resolution and launch before touching an independent WSL account", async provider => {
  const f = fixture();
  try {
    await expect(f.backend.invoke(`harness_resolve_${provider}`)).rejects.toThrow("cannot use the shared WSL Host yet");
    await expect(f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: [], cwd: "/repo", binaryProvider: provider })).rejects.toThrow("cannot use the shared WSL Host yet");
    expect(f.request).not.toHaveBeenCalled();
  } finally { await f.backend.close(); }
});

it.each(["pi", "opencode", "claude", "codex"])("applies the shared %s environment to catalog/version execution without running startup authentication", async provider => {
  const f = fixture();
  vi.mocked(wslSharedProviderEnvironment).mockResolvedValueOnce({ OPENAI_API_KEY: null, TEST_SHARED_HOME: "/mnt/c/account" });
  vi.mocked(wslProviderConfiguration).mockClear();
  try {
    await f.backend.invoke("harness_exec", { command: "/opt/provider", args: ["--version"], binaryProvider: provider });
    expect(f.request).toHaveBeenLastCalledWith("exec", expect.objectContaining({ env: { OPENAI_API_KEY: null, TEST_SHARED_HOME: "/mnt/c/account" } }));
    expect(wslProviderConfiguration).not.toHaveBeenCalled();
  } finally { await f.backend.close(); }
});

it("does not invent a second exit when a short-lived process exits before spawn acknowledgement", async () => {
  const f = fixture(true); const exit = vi.fn(); await f.backend.listen("harness-exit", exit);
  await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: [], cwd: "/repo", binaryProvider: "pi" });
  f.event({ stream: "", kind: "disconnect", data: "offline" });
  expect(exit).toHaveBeenCalledOnce(); await f.backend.close();
});

it("runs a managed JavaScript provider entry with the bundled Node for turns and catalog commands", async () => {
  const f = fixture(false, undefined, {}, async () => ({ command: "/runtime/bin/node", args: ["/providers/pi/cli.js"] }));
  try {
    expect(await f.backend.invoke("harness_resolve_pi")).toEqual({ path: "/runtime/bin/node", args: ["/providers/pi/cli.js"] });
    await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/runtime/bin/node", args: ["--mode", "rpc"], cwd: "/repo", binaryProvider: "pi" });
    expect(f.request).toHaveBeenCalledWith("process.spawn", expect.objectContaining({ command: "/runtime/bin/node", args: ["/providers/pi/cli.js", "--mode", "rpc"] }));
    expect(await f.backend.invoke("harness_exec", { command: "/runtime/bin/node", args: ["--version"], binaryProvider: "pi" })).toBe("1.0.0");
    expect(f.request).toHaveBeenLastCalledWith("exec", expect.objectContaining({ args: ["/providers/pi/cli.js", "--version"] }));
    // Some adapters already forward resolver arguments (Antigravity does).
    await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/runtime/bin/node", args: ["/providers/pi/cli.js", "--mode", "rpc"], cwd: "/repo", binaryProvider: "pi" });
    expect(f.request).toHaveBeenLastCalledWith("process.spawn", expect.objectContaining({ args: ["/providers/pi/cli.js", "--mode", "rpc"] }));
  } finally { await f.backend.close(); }
});

it("parses chunked SSE frames and reports interrupted processes", async () => {
  const f = fixture(); const data = vi.fn(); const ended = vi.fn();
  await f.backend.listen("harness-sse", data); await f.backend.listen("harness-sse-end", ended);
  await f.backend.invoke("harness_sse_open", { sessionId: "events", url: "http://localhost:1234/events" });
  const stream = String(f.request.mock.calls.find(([op]) => op === "net.sseOpen")![1]!.stream);
  f.event({ stream, kind: "sse", data: "data: hel" });
  f.event({ stream, kind: "sse", data: "lo\ndata: world\n\n" });
  expect(data).toHaveBeenCalledWith({ payload: { sessionId: "events", data: "hello\nworld" } });
  f.event({ stream: "", kind: "disconnect", data: "offline" }); expect(ended).toHaveBeenCalledOnce();
  await f.backend.close();
});

it("retains Windows Host ownership for Linux process lifetimes and releases on exit", async () => {
  const store = new HostStore(":memory:"); initCheckoutGuards(store);
  const f = fixture(false, store);
  try {
    await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: [], cwd: "/repo", binaryProvider: "pi" });
    expect(checkoutResources(store)).toEqual([expect.objectContaining({ path: "wsl%3AUbuntu:/repo", owner_pid: process.pid })]);
    f.event({ stream: "session", kind: "exit", data: { pid: 72, code: 0 } });
    expect(checkoutResources(store)).toEqual([]);
  } finally { await f.backend.close(); store.close(); }
});

it("merges session capabilities before shared-account overrides and refreshes Codex locally", async () => {
  const f = fixture(false, undefined, { WORKFLOW_CAPABILITY: "fixture", OPENAI_API_KEY: "inherited" });
  await f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: [], cwd: "/repo", binaryProvider: "codex" });
  expect(wslProviderConfiguration).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", cwd: "/repo" }));
  expect(refreshCodexAccountBeforeWsl).toHaveBeenCalledWith({ command: "C:\\codex.exe", home: "C:\\account", accountId: undefined });
  expect(f.request).toHaveBeenCalledWith("process.spawn", expect.objectContaining({ env: {
    MONOCODE_HOST: "1", WORKFLOW_CAPABILITY: "fixture", OPENAI_API_KEY: null, CODEX_HOME: "/mnt/c/account",
  } }));
  await f.backend.close();
});

it("does not launch when shutdown completes during runtime resolution", async () => {
  let resolve!: (value: { command: string }) => void;
  const f = fixture(false, undefined, {}, () => new Promise(done => { resolve = done; }));
  const pending = f.backend.invoke("harness_spawn", { sessionId: "session", command: "/opt/provider", args: [], cwd: "/repo", binaryProvider: "pi" });
  await f.backend.close();
  resolve({ command: "/opt/provider" });
  await expect(pending).rejects.toThrow("Host is stopping");
  expect(f.request.mock.calls.some(([op]) => op === "process.spawn")).toBe(false);
});

it("maps HTTP timeouts and discards failed or superseded SSE generations", async () => {
  const f = fixture(), data = vi.fn(), ended = vi.fn();
  await f.backend.listen("harness-sse", data); await f.backend.listen("harness-sse-end", ended);
  await f.backend.invoke("harness_http", { url: "http://localhost:1234", timeoutMs: 123 });
  expect(f.request).toHaveBeenLastCalledWith("net.http", expect.objectContaining({ timeout: 123 }));
  f.request.mockRejectedValueOnce(new Error("offline"));
  await expect(f.backend.invoke("harness_sse_open", { sessionId: "events", url: "http://localhost:1234" })).rejects.toThrow("offline");
  f.event({ stream: "", kind: "disconnect", data: "offline" });
  expect(ended).not.toHaveBeenCalled();
  await f.backend.invoke("harness_sse_open", { sessionId: "events", url: "http://localhost:1234" });
  const old = String(f.request.mock.lastCall![1]!.stream);
  await f.backend.invoke("harness_sse_open", { sessionId: "events", url: "http://localhost:1234" });
  const current = String(f.request.mock.lastCall![1]!.stream);
  expect(current).not.toBe(old);
  f.event({ stream: old, kind: "sse-close", data: null });
  f.event({ stream: current, kind: "sse", data: "data: active\n\n" });
  expect(data).toHaveBeenCalledWith({ payload: { sessionId: "events", data: "active" } });
  await f.backend.close();
});

it("does not allow arbitrary catalog execution", async () => {
  const f = fixture();
  await expect(f.backend.invoke("harness_exec", { command: "/opt/provider", args: ["-p", "unapproved"], binaryProvider: "claude" })).rejects.toThrow("catalog command");
  expect(f.request).not.toHaveBeenCalled(); await f.backend.close();
});
