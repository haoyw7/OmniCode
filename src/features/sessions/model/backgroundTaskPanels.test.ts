import { beforeEach, expect, it, vi } from "vitest";
import { backgroundTaskPanels, clearFinishedBackgroundTasks, publishBackgroundTaskPanel, releaseBackgroundTaskPanel, requestBackgroundTaskPanel, visibleBackgroundTasks } from "./backgroundTaskPanels";
import type { BackgroundTaskItem } from "./backgroundTasks";

beforeEach(() => backgroundTaskPanels.setState({}, true));

it("shares live output and clearing across views without removing running or other sessions' tasks", () => {
  const owner = Symbol();
  const tasks: BackgroundTaskItem[] = [{ id: "done", title: "Done", state: "completed" }, { id: "live", title: "Live", state: "running", output: "first" }];
  publishBackgroundTaskPanel("a", owner, tasks, vi.fn(), 100);
  publishBackgroundTaskPanel("b", Symbol(), tasks, undefined, 0);
  clearFinishedBackgroundTasks("a");
  expect(visibleBackgroundTasks(backgroundTaskPanels.getState().a).map(task => task.id)).toEqual(["live"]);
  expect(visibleBackgroundTasks(backgroundTaskPanels.getState().b)).toHaveLength(2);
  publishBackgroundTaskPanel("a", owner, [...tasks, { id: "new", title: "New", state: "completed" }].map(task => task.id === "live" ? { ...task, output: "second" } : task), undefined, 100);
  expect(visibleBackgroundTasks(backgroundTaskPanels.getState().a).map(task => task.id)).toEqual(["live", "new"]);
  expect(backgroundTaskPanels.getState().a.tasks[1].output).toBe("second");
  expect(tasks[1].output).toBe("first");
});

it("does not discard a replacement source and disables stopping when the owning source leaves", () => {
  const old = Symbol(), next = Symbol(), stop = vi.fn();
  publishBackgroundTaskPanel("a", old, [], undefined, 0);
  publishBackgroundTaskPanel("a", next, [{ id: "live", title: "Live", state: "running" }], stop, 20);
  releaseBackgroundTaskPanel("a", old);
  expect(backgroundTaskPanels.getState().a.onStop).toBe(stop);
  releaseBackgroundTaskPanel("a", next);
  expect(backgroundTaskPanels.getState().a.onStop).toBeUndefined();
  expect(backgroundTaskPanels.getState().a.tasks).toHaveLength(1);
});

it("allows repeated requests to reveal the same collapsed task", () => {
  requestBackgroundTaskPanel("a", "task");
  requestBackgroundTaskPanel("a", "task");
  expect(backgroundTaskPanels.getState().a).toMatchObject({ selectedTaskId: "task", request: 2 });
});
