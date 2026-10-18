// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  gitDiffFiles,
  gitFileDiff,
  type GitChangedFile,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";
import {
  sessionCheckpointStatus,
  sessionCheckpointFileDiff,
  type CheckpointStatus,
} from "../../sessions/model/checkpoint";
import { useReviewSource } from "./useReviewSource";
import type { ReviewSource } from "./reviewDiff";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";

const events = vi.hoisted(() => ({
  git: () => {},
  review: (_id?: string) => {},
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffFiles: vi.fn(),
  gitFileDiff: vi.fn(),
  subscribeGitChanged: (listener: () => void) => {
    events.git = listener;
    return () => { if (events.git === listener) events.git = () => {}; };
  },
}));
vi.mock("../../sessions/model/checkpoint", () => ({
  sessionCheckpointStatus: vi.fn(),
  sessionCheckpointFileDiff: vi.fn(),
  subscribeReviewChanged: (listener: (id?: string) => void) => {
    events.review = listener;
    return () => { if (events.review === listener) events.review = () => {}; };
  },
}));

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useReviewSource>;
const file: GitChangedFile = {
  path: "/repo/a.ts",
  relative: "a.ts",
  status: "modified",
  additions: 5,
  deletions: 4,
  staged: true,
  unstaged: true,
};
const index = (files = [file]) => ({ files }) as GitDiffIndex;
const checkpoint = (files = [file]) =>
  ({ files }) as unknown as CheckpointStatus;
const diff = {
  ...file,
  original: "old\n",
  current: "new\n",
  binary: false,
  tooLarge: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Harness({
  cwd,
  source,
  sessionId,
}: {
  cwd: string;
  source: ReviewSource;
  sessionId?: string;
}) {
  result = useReviewSource(cwd, source, sessionId);
  return null;
}
async function render(
  source: ReviewSource,
  cwd = "/repo",
  sessionId: string | undefined = "s1",
  strict = false,
  visible = true,
) {
  await act(async () => {
    const node = createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(Harness, { cwd, source, sessionId }));
    root.render(strict ? createElement(StrictMode, null, node) : node);
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(gitDiffFiles).mockResolvedValue(index());
  vi.mocked(sessionCheckpointStatus).mockResolvedValue(checkpoint());
  vi.mocked(gitFileDiff).mockResolvedValue(diff);
  vi.mocked(sessionCheckpointFileDiff).mockResolvedValue(diff);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("pauses hidden sources and reloads their checkpoint status when revealed", async () => {
  await render("session", "/repo", "s1", false, false);
  await act(async () => { events.review("s1"); window.dispatchEvent(new Event("focus")); });
  expect(sessionCheckpointStatus).not.toHaveBeenCalled();
  await render("session");
  expect(sessionCheckpointStatus).toHaveBeenCalledTimes(1);
  await render("session", "/repo", "s1", false, false);
  await act(async () => events.review("s1"));
  expect(sessionCheckpointStatus).toHaveBeenCalledTimes(1);
  vi.mocked(sessionCheckpointStatus).mockResolvedValue(checkpoint([]));
  await render("session");
  expect(sessionCheckpointStatus).toHaveBeenCalledTimes(2);
  expect(result.files).toEqual([]);
});

it("discards diff contents that may have changed while the surface was hidden", async () => {
  await render("session");
  await act(async () => { await result.loadDiff(file.path); });
  expect(sessionCheckpointFileDiff).toHaveBeenCalledTimes(1);
  await render("session", "/repo", "s1", false, false);
  await act(async () => events.review("s1"));
  vi.mocked(sessionCheckpointFileDiff).mockResolvedValue({ ...diff, current: "updated while hidden\n" });
  await render("session");
  await act(async () => { await result.loadDiff(file.path); });
  expect(sessionCheckpointFileDiff).toHaveBeenCalledTimes(2);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads only requested files, isolates sources, and keeps per-source cache across switches", async () => {
  await render("unstaged");
  expect(gitFileDiff).not.toHaveBeenCalled();
  expect(result.files?.[0]).toMatchObject({ additions: 0, deletions: 0 });
  await act(async () => result.loadDiff("a.ts"));
  expect(gitFileDiff).toHaveBeenLastCalledWith("/repo", "a.ts", "unstaged");
  await render("staged");
  expect(result.getDiff("a.ts")).toBeUndefined();
  await act(async () => result.loadDiff("a.ts"));
  expect(gitFileDiff).toHaveBeenLastCalledWith("/repo", "a.ts", "staged");
  await render("session");
  expect(sessionCheckpointStatus).toHaveBeenLastCalledWith("s1", "/repo");
  await act(async () => result.loadDiff("a.ts"));
  expect(sessionCheckpointFileDiff).toHaveBeenLastCalledWith(
    "s1",
    "/repo",
    "a.ts",
  );
  await render("unstaged");
  await act(async () => result.loadDiff("a.ts"));
  expect(gitFileDiff).toHaveBeenCalledTimes(2);
  expect(result.getDiff("a.ts")?.state).toBe("loaded");
});

it("keeps shared workspace disclosure scoped to the session recording", async () => {
  vi.mocked(sessionCheckpointStatus).mockResolvedValue({ ...checkpoint(), workspaceShared: true });
  await render("session");
  expect(result.workspaceShared).toBe(true);
  await render("unstaged");
  expect(result.workspaceShared).toBe(false);
});

it("filters each working-tree source, including a file with changes on both sides", async () => {
  const mixed = [
    file,
    { ...file, relative: "staged.ts", unstaged: false },
    { ...file, relative: "unstaged.ts", staged: false },
  ];
  vi.mocked(gitDiffFiles).mockResolvedValue(index(mixed));
  await render("staged");
  expect(result.files?.map((item) => item.relative)).toEqual([
    "a.ts",
    "staged.ts",
  ]);
  await render("unstaged");
  expect(result.files?.map((item) => item.relative)).toEqual([
    "a.ts",
    "unstaged.ts",
  ]);
});

it.each([false, true])(
  "ignores an obsolete list success/error after switching sources (error=%s)",
  async (reject) => {
    const pending = deferred<GitDiffIndex>();
    vi.mocked(gitDiffFiles).mockReturnValueOnce(pending.promise);
    await render("unstaged");
    expect(result.files).toBeNull();
    await render("session");
    await act(async () => {
      if (reject) pending.reject(new Error("obsolete git error"));
      else pending.resolve(index([{ ...file, relative: "obsolete.ts" }]));
    });
    expect(result.files?.map((item) => item.relative)).toEqual(["a.ts"]);
    expect(result.error).toBeUndefined();
  },
);

it("invalidates pending diffs on refresh and prevents an older index from replacing the new list", async () => {
  const oldIndex = deferred<GitDiffIndex>();
  vi.mocked(gitDiffFiles).mockReturnValueOnce(oldIndex.promise);
  await render("unstaged");
  await act(async () => result.refresh());
  const oldDiff = deferred<typeof diff>();
  vi.mocked(gitFileDiff).mockReturnValueOnce(oldDiff.promise);
  await act(async () => result.loadDiff("a.ts"));
  await act(async () => result.refresh());
  await act(async () => result.loadDiff("a.ts"));
  await act(async () => {
    oldIndex.resolve(index([]));
    oldDiff.resolve({ ...diff, current: "obsolete\n" });
  });
  expect(result.files).toHaveLength(1);
  const state = result.getDiff("a.ts");
  expect(state?.state === "loaded" && state.diff.current).toBe("new\n");
});

it("keeps the current rows during refresh but hides them when the source changes", async () => {
  await render("unstaged");
  const files = result.files;
  const refreshed = deferred<GitDiffIndex>();
  vi.mocked(gitDiffFiles).mockReturnValueOnce(refreshed.promise);
  await act(async () => result.refresh());
  expect(result.files).toBe(files);
  expect(result.loading).toBe(true);
  await act(async () => refreshed.resolve(index([])));
  expect(result.files).toEqual([]);
  expect(result.loading).toBe(false);
  const staged = deferred<GitDiffIndex>();
  vi.mocked(gitDiffFiles).mockReturnValueOnce(staged.promise);
  await render("staged");
  expect(result.files).toBeNull();
  await act(async () => staged.resolve(index()));
});

it("refreshes both working-tree caches on Git changes and only matching checkpoints on review changes", async () => {
  await render("unstaged");
  await act(async () => result.loadDiff("a.ts"));
  await render("staged");
  await act(async () => result.loadDiff("a.ts"));
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  await act(async () => {
    events.git();
    events.git();
    frame?.(0);
  });
  expect(result.getDiff("a.ts")).toBeUndefined();
  await render("unstaged");
  expect(result.getDiff("a.ts")).toBeUndefined();
  await render("session");
  await act(async () => result.loadDiff("a.ts"));
  await act(async () => events.review("another-session"));
  expect(result.getDiff("a.ts")?.state).toBe("loaded");
  await act(async () => events.review("s1"));
  expect(result.getDiff("a.ts")).toBeUndefined();
});

it("survives StrictMode effect replay and drops responses from an old cwd/session", async () => {
  await render("unstaged", "/repo", "s1", true);
  await act(async () => result.loadDiff("a.ts"));
  expect(result.getDiff("a.ts")?.state).toBe("loaded");
  const pending = deferred<typeof diff>();
  vi.mocked(sessionCheckpointFileDiff).mockReturnValueOnce(pending.promise);
  await render("session", "/repo", "s1", true);
  await act(async () => result.loadDiff("a.ts"));
  await render("session", "/other", "s2", true);
  await act(async () => pending.resolve(diff));
  expect(result.getDiff("a.ts")).toBeUndefined();
  expect(sessionCheckpointStatus).toHaveBeenLastCalledWith("s2", "/other");
  await act(async () => result.loadDiff("a.ts"));
  expect(sessionCheckpointFileDiff).toHaveBeenLastCalledWith(
    "s2",
    "/other",
    "a.ts",
  );
  expect(result.getDiff("a.ts")?.state).toBe("loaded");
});
