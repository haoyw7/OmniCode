// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useWorkerPool } from "@pierre/diffs/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  REVIEW_POOL_IDLE_MS,
  ReviewDiffsWorkerPool,
} from "./ReviewDiffsWorkerPool";

const state = vi.hoisted(() => ({
  initialize: () => Promise.resolve(),
  factoryFails: false,
  managers: [] as { terminate: ReturnType<typeof vi.fn> }[],
  workers: [] as (EventTarget & { terminate: ReturnType<typeof vi.fn> })[],
}));
vi.mock("@pierre/diffs", () => ({
  preloadHighlighter: vi.fn(() => Promise.resolve()),
  registerCustomTheme: vi.fn(),
}));
vi.mock("@pierre/diffs/worker", () => ({
  WorkerPoolManager: class {
    terminate = vi.fn();
    constructor(
      private options: { workerFactory: () => Worker; poolSize: number },
    ) {
      state.managers.push(this);
    }
    initialize() {
      for (let n = 0; n < this.options.poolSize; n++)
        this.options.workerFactory();
      return state.initialize();
    }
  },
}));
let root: Root;
let container: HTMLDivElement;
function Probe() {
  return createElement("span", {
    "data-mode": useWorkerPool() ? "worker" : "main",
  });
}
const mode = () => container.querySelector("span")?.getAttribute("data-mode");
async function render() {
  await act(async () =>
    root.render(
      createElement(ReviewDiffsWorkerPool, { children: createElement(Probe) }),
    ),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.initialize = () => Promise.resolve();
  state.factoryFails = false;
  state.managers = [];
  state.workers = [];
  vi.stubGlobal(
    "Worker",
    class extends EventTarget {
      terminate = vi.fn();
      constructor() {
        super();
        if (state.factoryFails) throw new Error("worker blocked");
        state.workers.push(this);
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  // Release the shared pool so each test starts cold.
  act(() => vi.advanceTimersByTime(REVIEW_POOL_IDLE_MS));
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("provides the pool only after successful initialization and keeps it warm until idle", async () => {
  let ready!: () => void;
  state.initialize = () =>
    new Promise<void>((resolve) => {
      ready = resolve;
    });
  await render();
  expect(mode()).toBe("main");
  expect(state.workers.length).toBeGreaterThan(0);
  expect(state.workers.length).toBeLessThanOrEqual(4);
  await act(async () => ready());
  expect(mode()).toBe("worker");
  act(() => root.unmount());
  root = createRoot(container);
  // Reopening within the idle window reuses the initialized pool.
  await render();
  expect(mode()).toBe("worker");
  expect(state.managers).toHaveLength(1);
  act(() => root.unmount());
  root = createRoot(container);
  expect(state.managers[0].terminate).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(REVIEW_POOL_IDLE_MS));
  expect(state.managers[0].terminate).toHaveBeenCalled();
  expect(
    state.workers.every((worker) => worker.terminate.mock.calls.length),
  ).toBe(true);
});

it.each(["factory", "reject", "timeout", "error", "messageerror"])(
  "keeps main-thread highlighting available on %s failure",
  async (failure) => {
    let ready!: () => void;
    if (failure === "factory") state.factoryFails = true;
    else if (failure === "reject")
      state.initialize = () => Promise.reject(new Error("init failed"));
    else if (failure === "timeout")
      state.initialize = () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        });
    await render();
    if (failure === "timeout") {
      act(() => vi.advanceTimersByTime(10_000));
      await act(async () => ready());
    } else if (failure === "error" || failure === "messageerror") {
      expect(mode()).toBe("worker");
      act(() => state.workers[0].dispatchEvent(new Event(failure)));
    }
    expect(mode()).toBe("main");
    expect(state.managers[0].terminate).toHaveBeenCalled();
    expect(
      state.workers.every((worker) => worker.terminate.mock.calls.length),
    ).toBe(true);
  },
);

it("uses the main thread when workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  await render();
  expect(mode()).toBe("main");
  expect(state.managers).toHaveLength(0);
});
