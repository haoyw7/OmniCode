import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCancelledError, QueryObserver } from "@tanstack/react-query";
import { queryClient } from "../../../../shared/lib/queryClient";
import type { ProjectFile } from "../../../../platform/tauri/fs";
import { listProjectFiles } from "../../../../platform/tauri/fs";
import {
  invalidateProjectFiles,
  loadProjectFiles,
  peekProjectFiles,
  rememberOpenedFile,
  resolveFileOpenRequest,
  resolveOpenablePath,
  projectFilesQuery,
  projectFileKeys,
} from "./fileIndex";
import { notifyDirsChanged } from "./fileTree";

const cwd = "/Users/me/project";
const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/desktop/src/App.tsx",
    relative: "apps/desktop/src/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/web/src/App.tsx",
    relative: "apps/web/src/App.tsx",
  },
  {
    name: "main.tsx",
    path: "/Users/me/project/apps/desktop/src/main.tsx",
    relative: "apps/desktop/src/main.tsx",
  },
];

const extra: ProjectFile = {
  name: "pasted.ts",
  path: "/Users/me/project/pasted.ts",
  relative: "pasted.ts",
};

vi.mock("../../../../platform/tauri/fs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../platform/tauri/fs")>();
  return {
    ...actual,
    listProjectFiles: vi.fn(async () => files),
  };
});

const list = vi.mocked(listProjectFiles);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("resolveOpenablePath", () => {
  beforeEach(() => {
    queryClient.clear();
    list.mockReset();
    list.mockResolvedValue(files);
  });

  it("maps a basename-only link to the shortest matching project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("prefers recently opened files for ambiguous basenames", async () => {
    rememberOpenedFile(cwd, files[1].path);
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("matches a relative project path", async () => {
    const resolved = await resolveOpenablePath(
      cwd,
      "apps/desktop/src/main.tsx",
    );
    expect(resolved).toBe(files[2].path);
  });

  it("still opens a direct file when the optional project index is unavailable", async () => {
    list.mockRejectedValue(new Error("Project scan unavailable"));
    await expect(
      resolveOpenablePath(cwd, "apps/desktop/src/main.tsx"),
    ).resolves.toBe(files[2].path);
  });

  it("preserves an exact path even when it is absent from the project index", async () => {
    const ignored = `${cwd}/ignored/App.tsx`;
    await expect(
      resolveFileOpenRequest(cwd, ignored, { exact: true }),
    ).resolves.toBe(ignored);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("loadProjectFiles", () => {
  beforeEach(() => {
    queryClient.clear();
    list.mockReset();
    list.mockResolvedValue(files);
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it("returns the cached listing until refresh", async () => {
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);
    expect(await loadProjectFiles(cwd)).toEqual(files);
    expect(list).toHaveBeenCalledTimes(1);
    expect(await loadProjectFiles(cwd, true)).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("does not drop a refresh that arrives while a scan is in flight", async () => {
    const first = deferred<ProjectFile[]>();
    const second = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => first.promise);
    list.mockImplementationOnce(() => second.promise);

    const initial = loadProjectFiles(cwd);
    const cancelled = initial.catch((error: unknown) => error);
    const refresh = loadProjectFiles(cwd, true);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list).toHaveBeenCalledTimes(2);

    first.resolve(files);
    expect(isCancelledError(await cancelled)).toBe(true);
    expect(peekProjectFiles(cwd)).toBeNull();

    second.resolve([...files, extra]);
    expect(await refresh).toEqual([...files, extra]);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
  });

  it("reuses the in-flight scan when refresh is not requested", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const first = loadProjectFiles(cwd);
    const second = loadProjectFiles(cwd);
    expect(list).toHaveBeenCalledTimes(1);

    pending.resolve(files);
    expect(await first).toEqual(files);
    expect(await second).toEqual(files);
  });

  it("keeps both worktree indexes during repeated tab switches", async () => {
    const other = "/Users/me/project-worktree";
    const otherFiles = [{ ...extra, path: `${other}/pasted.ts` }];
    list.mockImplementation(async (path) =>
      path === cwd ? files : otherFiles,
    );

    for (let index = 0; index < 10; index++) {
      expect(await loadProjectFiles(cwd)).toBe(files);
      expect(await loadProjectFiles(other)).toBe(otherFiles);
    }
    expect(list).toHaveBeenCalledTimes(2);
    expect(peekProjectFiles(cwd)).toBe(files);
    expect(peekProjectFiles(other)).toBe(otherFiles);
  });

  it("lets scans for separate worktrees finish independently", async () => {
    const other = "/Users/me/project-worktree";
    const first = deferred<ProjectFile[]>();
    const second = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => first.promise);
    list.mockImplementationOnce(() => second.promise);
    const firstScan = loadProjectFiles(cwd);
    const secondScan = loadProjectFiles(other);
    const repeated = [loadProjectFiles(cwd), loadProjectFiles(other)];
    first.resolve(files);
    second.resolve([extra]);
    await Promise.all([firstScan, secondScan]);
    expect(await Promise.all(repeated)).toEqual([files, [extra]]);
    expect(peekProjectFiles(cwd)).toBe(files);
    expect(peekProjectFiles(other)).toEqual([extra]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("invalidates one worktree without evicting or cancelling another", async () => {
    const other = "/Users/me/project-worktree";
    await loadProjectFiles(cwd);
    await loadProjectFiles(other);
    await invalidateProjectFiles(cwd);
    expect(queryClient.getQueryState(projectFileKeys.cwd(cwd))?.isInvalidated).toBe(true);
    expect(await loadProjectFiles(other)).toBe(files);
    expect(list).toHaveBeenCalledTimes(2);
    await loadProjectFiles(cwd);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not let an invalidated scan restore its old listing", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);
    const scan = loadProjectFiles(cwd);
    const cancelled = scan.catch((error: unknown) => error);
    await invalidateProjectFiles(cwd);
    pending.resolve(files);
    expect(isCancelledError(await cancelled)).toBe(true);
    expect(peekProjectFiles(cwd)).toBeNull();
  });

  it("bounds retained worktrees and keeps recently revisited ones", async () => {
    for (let index = 0; index < 8; index++) {
      await loadProjectFiles(`/repo/tree-${index}`);
    }
    await loadProjectFiles("/repo/tree-0");
    await loadProjectFiles("/repo/tree-8");
    expect(peekProjectFiles("/repo/tree-0")).toBe(files);
    expect(peekProjectFiles("/repo/tree-1")).toBeNull();
    expect(list).toHaveBeenCalledTimes(9);
  });

  it("refreshes an observed first scan after a write and ignores its late result", async () => {
    const pending = deferred<ProjectFile[]>();
    list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([extra]);
    const observer = new QueryObserver(queryClient, projectFilesQuery(cwd));
    const stop = observer.subscribe(() => {});
    await invalidateProjectFiles(cwd);
    expect(observer.getCurrentResult().data).toEqual([extra]);
    pending.resolve(files);
    await Promise.resolve();
    expect(peekProjectFiles(cwd)).toEqual([extra]);
    expect(list).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps mounted worktrees and unfinished scans when trimming inactive indexes", async () => {
    const observer = new QueryObserver(queryClient, projectFilesQuery(cwd));
    const stop = observer.subscribe(() => {});
    await loadProjectFiles(cwd);
    const pending = deferred<ProjectFile[]>();
    list.mockReturnValueOnce(pending.promise);
    const scan = loadProjectFiles("/repo/pending");
    for (let index = 0; index < 10; index++) await loadProjectFiles(`/repo/tree-${index}`);
    expect(observer.getCurrentResult().data).toEqual(files);
    expect(queryClient.getQueryState(projectFileKeys.cwd("/repo/pending"))?.fetchStatus).toBe("fetching");
    pending.resolve([extra]);
    expect(await scan).toEqual([extra]);
    stop();
  });

  it("keeps the last listing when a refresh fails and retries on the next read", async () => {
    await loadProjectFiles(cwd);
    list.mockRejectedValueOnce(new Error("offline"));
    await expect(loadProjectFiles(cwd, true)).rejects.toThrow("offline");
    expect(peekProjectFiles(cwd)).toEqual(files);
    list.mockResolvedValueOnce([extra]);
    expect(await loadProjectFiles(cwd)).toEqual([extra]);
  });

  it("shares the preloaded listing with Query observers", async () => {
    const onChange = vi.fn();
    await loadProjectFiles(cwd);
    const observer = new QueryObserver(queryClient, projectFilesQuery(cwd));
    const stop = observer.subscribe(onChange);
    expect(observer.getCurrentResult().data).toEqual(files);
    expect(list).toHaveBeenCalledTimes(1);
    expect(peekProjectFiles(cwd)).toEqual(files);
    stop();
  });

  it("reloads after a directory change", async () => {
    vi.useFakeTimers();
    await loadProjectFiles(cwd);
    list.mockResolvedValue([...files, extra]);

    const onChange = vi.fn();
    const observer = new QueryObserver(queryClient, projectFilesQuery(cwd));
    const stop = observer.subscribe(onChange);
    onChange.mockClear();
    notifyDirsChanged();

    await vi.advanceTimersByTimeAsync(150);
    expect(peekProjectFiles(cwd)).toEqual([...files, extra]);
    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it("does not drop a scan for a different project", async () => {
    const other = "/Users/me/other";
    const pending = deferred<ProjectFile[]>();
    list.mockImplementationOnce(() => pending.promise);

    const scan = loadProjectFiles(other);
    await invalidateProjectFiles(cwd);
    pending.resolve(files);

    expect(await scan).toEqual(files);
    expect(peekProjectFiles(other)).toEqual(files);
  });
});
