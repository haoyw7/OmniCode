import { expect, it, vi } from "vitest";
import { ChildBackendRegistry, type ChildBackend } from "./childBackendRegistry";

function backend() {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const invoke = vi.fn(async () => 123);
  return { invoke, listeners, listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler); return () => { listeners.delete(event); };
  }) };
}
it("pins process ownership and broadcasts cleanup across machines", async () => {
  const registry = new ChildBackendRegistry(); const local = backend(); const wsl = backend();
  registry.register("local", local as ChildBackend); registry.register("wsl:Ubuntu", wsl as ChildBackend);
  let selected = "wsl:Ubuntu"; registry.setSelector(() => selected);
  await registry.invoke("harness_spawn", { sessionId: "linux" });
  selected = "local";
  await registry.invoke("harness_write", { sessionId: "linux", line: "hello" });
  expect(wsl.invoke).toHaveBeenLastCalledWith("harness_write", { sessionId: "linux", line: "hello" });
  expect(local.invoke).not.toHaveBeenCalled();
  await registry.invoke("harness_kill_all");
  expect(local.invoke).toHaveBeenCalledWith("harness_kill_all", undefined);
  expect(wsl.invoke).toHaveBeenLastCalledWith("harness_kill_all", undefined);
});
it("subscribes a machine registered after bridge startup before spawning", async () => {
  const registry = new ChildBackendRegistry(); const local = backend(); const wsl = backend();
  registry.register("local", local as ChildBackend);
  const event = vi.fn(); const stop = await registry.listen("harness-stdout", event);
  registry.register("wsl:Ubuntu", wsl as ChildBackend); registry.setSelector(() => "wsl:Ubuntu");
  await registry.invoke("harness_spawn", { sessionId: "linux" });
  wsl.listeners.get("harness-stdout")?.({ payload: "output" });
  expect(event).toHaveBeenCalledWith({ payload: "output" });
  stop(); expect(wsl.listeners.size).toBe(0); expect(local.listeners.size).toBe(0);
});

it.each(["monocode-pi-text", "monocode-omp-text", "monocode-pi-probe", "monocode-omp-probe"])("rebinds utility %s to local, Ubuntu and Debian while retaining its latest write owner", async sessionId => {
  const registry = new ChildBackendRegistry();
  const machines = new Map(["local", "wsl:Ubuntu", "wsl:Debian"].map(key => [key, backend()]));
  for (const [key, value] of machines) registry.register(key, value as ChildBackend);
  let selected = "local"; registry.setSelector(() => selected);
  let previous: string | undefined;
  for (const key of ["local", "wsl:Ubuntu", "wsl:Debian", "local"]) {
    selected = key;
    expect(registry.usesSelectedMachine(sessionId)).toBe(previous === undefined || previous === key);
    await registry.invoke("harness_spawn", { sessionId, command: `${key}/provider` });
    expect(machines.get(key)!.invoke).toHaveBeenLastCalledWith("harness_spawn", { sessionId, command: `${key}/provider` });
    if (previous) expect(machines.get(previous)!.invoke).toHaveBeenCalledWith("harness_kill", { sessionId });
    expect(registry.usesSelectedMachine(sessionId)).toBe(true);
    selected = "unrelated-context";
    await registry.invoke("harness_write", { sessionId, line: "input" });
    expect(machines.get(key)!.invoke).toHaveBeenLastCalledWith("harness_write", { sessionId, line: "input" });
    await registry.invoke("harness_exec", { sessionId, args: ["cleanup"] });
    expect(machines.get(key)!.invoke).toHaveBeenLastCalledWith("harness_exec", { sessionId, args: ["cleanup"] });
    await registry.invoke("harness_http", { sessionId, url: "http://localhost:1234/abort" });
    expect(machines.get(key)!.invoke).toHaveBeenLastCalledWith("harness_http", { sessionId, url: "http://localhost:1234/abort" });
    previous = key;
  }
});

it("discards previous-machine exit events even when distributions reuse the same PID", async () => {
  const registry = new ChildBackendRegistry(), ubuntu = backend(), debian = backend();
  registry.register("wsl:Ubuntu", ubuntu as ChildBackend); registry.register("wsl:Debian", debian as ChildBackend);
  let selected = "wsl:Ubuntu"; registry.setSelector(() => selected);
  const exit = vi.fn(), stop = await registry.listen("harness-exit", exit);
  const event = { payload: { sessionId: "utility", pid: 123, code: 0 } };
  try {
    await registry.invoke("harness_spawn", { sessionId: "utility" });
    ubuntu.invoke.mockImplementationOnce(async () => { ubuntu.listeners.get("harness-exit")?.(event); return 123; });
    selected = "wsl:Debian";
    await registry.invoke("harness_spawn", { sessionId: "utility" });
    ubuntu.listeners.get("harness-exit")?.(event);
    expect(exit).not.toHaveBeenCalled();
    debian.listeners.get("harness-exit")?.(event);
    expect(exit).toHaveBeenCalledExactlyOnceWith(event);
  } finally { stop(); }
});
