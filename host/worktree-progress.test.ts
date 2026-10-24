import { expect, it } from "vitest";
import { WorktreeCreationProgress } from "./worktree-progress";

it("streams lines by offset, isolates devices and expires finished progress", () => {
  let now = 0;
  const progress = new WorktreeCreationProgress(() => now);
  expect(progress.begin("device-a", undefined)).toBeUndefined();
  expect(() => progress.begin("device-a", "../bad")).toThrow("Invalid");
  const sink = progress.begin("device-a", "creation-1")!;
  expect(() => progress.begin("device-a", "creation-1")).toThrow("already in use");
  expect(progress.read("device-a", "creation-1", 0)).toEqual({ lines: [], offset: 0, done: false });
  sink.line("Preparing worktree");
  sink.line("Updating files: 50% (1/2)");
  const first = progress.read("device-a", "creation-1", 0);
  expect(first).toEqual({ lines: ["Preparing worktree", "Updating files: 50% (1/2)"], offset: 2, done: false });
  sink.line("HEAD is now at abc");
  sink.finish();
  sink.line("late");
  expect(progress.read("device-a", "creation-1", first.offset)).toEqual({ lines: ["HEAD is now at abc"], offset: 3, done: true });
  expect(progress.read("device-b", "creation-1", 0)).toEqual({ lines: [], offset: 0, done: false });
  expect(() => progress.read("device-a", "creation-1", -1)).toThrow("offset");
  now += 120_001;
  expect(progress.read("device-a", "creation-1", 0)).toEqual({ lines: [], offset: 0, done: false });
});
