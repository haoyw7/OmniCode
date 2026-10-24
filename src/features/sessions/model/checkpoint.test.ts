// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { keepSessionChanges, registerHostCheckpointRoute, sessionCheckpointFileDiff, sessionCheckpointStatus, undoSessionChanges } from "./checkpoint";

it("routes a Host conversation's review, Keep and whole-turn Undo to its Host", async () => {
  const route = vi.fn(async () => ({ files: [] }));
  const unregister = registerHostCheckpointRoute("tab", route);
  await sessionCheckpointStatus("tab", "/repo");
  await sessionCheckpointStatus("tab", "/repo", undefined, "first");
  await sessionCheckpointFileDiff("tab", "/repo", "a.ts", "first");
  await undoSessionChanges("tab", "/repo");
  await keepSessionChanges("tab", "/repo");
  expect(route.mock.calls).toEqual([
    ["status"], ["status", undefined, "first"], ["diff", "a.ts", "first"], ["undo"], ["keep", undefined],
  ]);
  unregister();
});

it("never falls back to a store on this computer without a Host route", async () => {
  const route = vi.fn(async () => ({ files: [] }));
  registerHostCheckpointRoute("tab", route)();
  await expect(sessionCheckpointStatus("tab", "/repo")).rejects.toThrow(/connected to its Host/);
  await expect(undoSessionChanges("tab", "/repo")).rejects.toThrow(/connected to its Host/);
  await expect(keepSessionChanges("tab", "/repo")).rejects.toThrow(/connected to its Host/);
  expect(route).not.toHaveBeenCalled();
});

it("a replaced route is not removed by the earlier registration's cleanup", async () => {
  const first = vi.fn(async () => ({ files: [] }));
  const second = vi.fn(async () => ({ files: [] }));
  const unregisterFirst = registerHostCheckpointRoute("tab", first);
  const unregisterSecond = registerHostCheckpointRoute("tab", second);
  unregisterFirst();
  await sessionCheckpointStatus("tab", "/repo");
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  unregisterSecond();
});
