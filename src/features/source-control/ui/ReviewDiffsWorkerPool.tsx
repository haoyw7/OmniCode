// Adapted from ZCode (Apache-2.0).
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { preloadHighlighter } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import ReviewDiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { reviewThemes } from "./reviewThemes";
import { useCodeThemes } from "../../settings/model/codeAppearance";

const highlighterOptions = {
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
  updates: Promise<void>;
};

let entry: PoolEntry | undefined;
let users = 0;
let idleTimer: number | undefined;
const usePool = create(() => ({ manager: undefined as WorkerPoolManager | undefined }));
const notify = () => usePool.setState({ manager: entry?.ready ? entry.manager : undefined });

function startPool(): PoolEntry {
  let stopped = false;
  const workers: Worker[] = [];
  const current: PoolEntry = { ready: false, stop: () => undefined, updates: Promise.resolve() };
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
            name: "omnicode-review-diffs",
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
      { ...highlighterOptions, theme: reviewThemes() },
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
    themes: Object.values(reviewThemes()),
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

export function ReviewDiffsWorkerPool({ children }: { children: ReactNode }) {
  const pool = usePool(state => state.manager);
  const themes = useCodeThemes();
  useEffect(() => {
    acquire();
    return release;
  }, []);
  useEffect(() => {
    const target = entry;
    if (!pool || target?.manager !== pool) return;
    let current = true;
    // Serialize asynchronous theme loads so a rapid reversal finishes with
    // the latest selection while preserving the warm worker pool.
    target.updates = target.updates.then(async () => {
      if (current) await pool.setRenderOptions({ ...highlighterOptions, theme: reviewThemes(themes) });
    }).catch(() => { if (entry?.manager === pool) entry.stop(); });
    return () => { current = false; };
  }, [pool, themes.light, themes.dark]);
  return (
    <WorkerPoolContext.Provider value={pool}>
      {children}
    </WorkerPoolContext.Provider>
  );
}
