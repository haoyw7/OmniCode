// Adapted from ZCode (Apache-2.0).
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { preloadHighlighter } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import ReviewDiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { REVIEW_THEMES } from "./reviewThemes";

const highlighterOptions = {
  theme: REVIEW_THEMES,
  preferredHighlighter: "shiki-wasm",
  lineDiffType: "word-alt",
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
  useTokenTransformer: false,
} as const;

/** Keep the pool warm between review panes; reopening should not re-init shiki. */
export const REVIEW_POOL_IDLE_MS = 60_000;

type PoolEntry = {
  manager?: WorkerPoolManager;
  ready: boolean;
  stop: () => void;
};

let entry: PoolEntry | undefined;
let users = 0;
let idleTimer: number | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function startPool(): PoolEntry {
  let stopped = false;
  const workers: Worker[] = [];
  const current: PoolEntry = { ready: false, stop: () => undefined };
  // Pierre 1.1 can leave initialization pending on an asset/worker load error.
  // Keep main-thread highlighting available until initialization succeeds,
  // and return to it on failure rather than trusting isWorkingPool().
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timeout);
    current.manager?.terminate();
    for (const worker of workers) {
      worker.removeEventListener("error", stop);
      worker.removeEventListener("messageerror", stop);
      worker.terminate();
    }
    const wasReady = current.ready;
    current.ready = false;
    if (wasReady) notify();
  };
  current.stop = stop;
  const timeout = window.setTimeout(stop, 10_000);
  try {
    const manager = new WorkerPoolManager(
      {
        workerFactory: () => {
          // Bundle Pierre's entry directly: its package marks the worker as
          // side-effect free, which erases a wrapper's bare static import.
          const worker = new ReviewDiffsWorker({
            name: "monocode-review-diffs",
          });
          worker.addEventListener("error", stop);
          worker.addEventListener("messageerror", stop);
          workers.push(worker);
          return worker;
        },
        poolSize: Math.max(
          1,
          Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)),
        ),
        totalASTLRUCacheSize: 40,
      },
      highlighterOptions,
    );
    current.manager = manager;
    void manager
      .initialize()
      .then(() => {
        if (stopped) return;
        window.clearTimeout(timeout);
        current.ready = true;
        notify();
      })
      .catch(stop);
  } catch {
    stop();
  }
  return current;
}

function acquire() {
  users++;
  window.clearTimeout(idleTimer);
  idleTimer = undefined;
  if (entry) return;
  // Main-thread fallback renders nothing until a highlighter exists; with the
  // themes loaded it shows plain text at once and highlights afterwards.
  void preloadHighlighter({
    themes: [REVIEW_THEMES.light, REVIEW_THEMES.dark],
    langs: [],
    preferredHighlighter: highlighterOptions.preferredHighlighter,
  }).catch(() => undefined);
  if (typeof Worker !== "undefined") entry = startPool();
}

function release() {
  users = Math.max(0, users - 1);
  if (users || idleTimer !== undefined) return;
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined;
    if (users) return;
    const previous = entry;
    entry = undefined;
    previous?.stop();
    notify();
  }, REVIEW_POOL_IDLE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => (entry?.ready ? entry.manager : undefined);

export function ReviewDiffsWorkerPool({ children }: { children: ReactNode }) {
  const pool = useSyncExternalStore(subscribe, snapshot, () => undefined);
  useEffect(() => {
    acquire();
    return release;
  }, []);
  return (
    <WorkerPoolContext.Provider value={pool}>
      {children}
    </WorkerPoolContext.Provider>
  );
}
