import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("counts reasons without logging session IDs, paths, or provider data", async () => {
  vi.resetModules();
  vi.stubEnv("DEV", true);
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const diagnostics = await import("./localExecutionDiagnostics");
  diagnostics.configureLocalExecutionDiagnostics(() => "host-not-ready");
  const context = { sessionId: "private-id", cwd: "/private/path" };
  diagnostics.recordLocalExecution("harness_spawn", context);
  diagnostics.recordLocalExecution("harness_spawn", context);
  const clear = diagnostics.setLocalExecutionReason(context.sessionId, "inbox");
  diagnostics.recordLocalExecution("session_checkpoint_capture", context);
  clear();
  diagnostics.recordLocalExecution("session_upsert", context);
  expect(log.mock.calls).toEqual([
    ["[local-execution]", { command: "harness_spawn", reason: "host-not-ready", count: 1 }],
    ["[local-execution]", { command: "harness_spawn", reason: "host-not-ready", count: 2 }],
    ["[local-execution]", { command: "session_checkpoint_capture", reason: "inbox", count: 1 }],
    ["[local-execution]", { command: "session_upsert", reason: "host-not-ready", count: 1 }],
  ]);
});

it("does not log or resolve application context in release builds", async () => {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const diagnostics = await import("./localExecutionDiagnostics");
  const resolve = vi.fn(() => "legacy-local" as const);
  diagnostics.configureLocalExecutionDiagnostics(resolve);
  diagnostics.recordLocalExecution("harness_spawn", { cwd: "~" });
  expect(log).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
});

it.each([true, false])("cleans overlapping session reasons in either completion order (older first: %s)", async (olderFirst) => {
  vi.resetModules();
  vi.stubEnv("DEV", true);
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const diagnostics = await import("./localExecutionDiagnostics");
  const context = { sessionId: "private-id", cwd: "/private/path" };
  const older = diagnostics.setLocalExecutionReason(context.sessionId, "restore-binding");
  const newer = diagnostics.setLocalExecutionReason(context.sessionId, "inbox");
  diagnostics.recordLocalExecution("harness_spawn", context);
  const first = olderFirst ? older : newer;
  const last = olderFirst ? newer : older;
  first();
  first(); // Cleanup is idempotent and cannot remove another live scope.
  diagnostics.recordLocalExecution("harness_spawn", context);
  last();
  diagnostics.recordLocalExecution("harness_spawn", context);
  expect(log.mock.calls.map(([, data]) => data.reason)).toEqual([
    "inbox", olderFirst ? "inbox" : "restore-binding", "legacy-local",
  ]);
});

it("uses an explicit call reason before the session scope and recognizes home drafts", async () => {
  vi.resetModules();
  vi.stubEnv("DEV", true);
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const diagnostics = await import("./localExecutionDiagnostics");
  const clear = diagnostics.setLocalExecutionReason("s", "inbox");
  diagnostics.recordLocalExecution("harness_spawn", { sessionId: "s", reason: "utility" });
  clear();
  diagnostics.recordLocalExecution("session_upsert", { sessionId: "s", cwd: "~" });
  expect(log.mock.calls.map(([, data]) => data.reason)).toEqual(["utility", "home-draft"]);
});
