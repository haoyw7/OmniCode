// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as checkpoint from "./checkpoint";
import {
  keepSessionChanges,
  registerHostCheckpointRoute,
  sessionCheckpointFileDiff,
  sessionCheckpointStatus,
  undoSessionChanges,
} from "./checkpoint";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ files: [] });
});
afterEach(() => vi.clearAllMocks());

it("routes a Host conversation's review, Keep and Undo to its Host", async () => {
  const route = vi.fn(async () => ({ files: [] }));
  const unregister = registerHostCheckpointRoute("tab", route);
  await sessionCheckpointStatus("tab", "/repo");
  await sessionCheckpointFileDiff("tab", "/repo", "a.ts");
  await undoSessionChanges("tab", "/repo", "a.ts");
  await keepSessionChanges("tab", "/repo");
  expect(route.mock.calls).toEqual([["status"], ["diff", "a.ts"], ["undo", "a.ts"], ["keep", undefined]]);
  expect(invoke).not.toHaveBeenCalled();

  unregister();
  await sessionCheckpointStatus("tab", "/repo");
  expect(invoke).toHaveBeenCalledWith("session_checkpoint_status", { sessionId: "tab", cwd: "/repo" });
});

it("passes persisted edit evidence when resuming and reviewing a restored session", async () => {
  await checkpoint.beginSessionTurn("s", "/repo", ["README.md"]);
  expect(invoke).toHaveBeenCalledWith(
    "session_checkpoint_begin_turn",
    expect.objectContaining({
      sessionId: "s",
      cwd: "/repo",
      editedPaths: ["README.md"],
    }),
  );
  await checkpoint.sessionCheckpointStatus("s", "/repo", ["README.md"]);
  expect(invoke).toHaveBeenLastCalledWith("session_checkpoint_status", {
    sessionId: "s",
    cwd: "/repo",
    editedPaths: ["README.md"],
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("waits for the baseline before begin resolves and for cancellation before capture", async () => {
  const baseline = deferred();
  const stopped = deferred();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "session_checkpoint_begin_turn") await baseline.promise;
    return undefined;
  });
  let ready = false;
  const begin = checkpoint.beginSessionTurn("s", "/repo").then((id) => {
    ready = true;
    return id;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  baseline.resolve();
  const turnId = await begin;
  const finish = checkpoint.finishSessionTurn("s", "/repo", {
    turnId,
    after: stopped.promise,
  });
  const status = checkpoint.sessionCheckpointStatus("s", "/repo");
  await Promise.resolve();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "session_checkpoint_begin_turn",
  ]);
  stopped.resolve();
  await Promise.all([finish, status]);
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "session_checkpoint_begin_turn",
    "session_checkpoint_finish_turn",
    "session_checkpoint_status",
  ]);
  expect(invoke).toHaveBeenCalledWith("session_checkpoint_finish_turn", {
    sessionId: "s",
    cwd: "/repo",
    turnId,
  });
});

it("an old completion cannot clear the newer turn's active token", async () => {
  const first = await checkpoint.beginSessionTurn("s", "/repo");
  const second = await checkpoint.beginSessionTurn("s", "/repo");
  await checkpoint.finishSessionTurn("s", "/repo", { turnId: first });
  await checkpoint.finishSessionTurn("s", "/repo");
  expect(invoke).toHaveBeenLastCalledWith("session_checkpoint_finish_turn", {
    sessionId: "s",
    cwd: "/repo",
    turnId: second,
  });
  expect(second).not.toBe(first);
});

it("does not capture a workspace when no local turn was started", async () => {
  await checkpoint.finishSessionTurn("idle", "/repo");
  expect(invoke).not.toHaveBeenCalled();
});

it("passes persisted edit evidence when resuming and reviewing a restored session", async () => {
  await checkpoint.beginSessionTurn("s", "/repo", ["README.md"]);
  expect(invoke).toHaveBeenCalledWith(
    "session_checkpoint_begin_turn",
    expect.objectContaining({
      sessionId: "s",
      cwd: "/repo",
      editedPaths: ["README.md"],
    }),
  );
  await checkpoint.sessionCheckpointStatus("s", "/repo", ["README.md"]);
  expect(invoke).toHaveBeenLastCalledWith("session_checkpoint_status", {
    sessionId: "s",
    cwd: "/repo",
    editedPaths: ["README.md"],
  });
});
