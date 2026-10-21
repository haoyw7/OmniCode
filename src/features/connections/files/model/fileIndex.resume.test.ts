// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { queryClient } from "../../../../shared/lib/queryClient";
import { listProjectFiles, type ProjectFile } from "../../../../platform/tauri/fs";
import {
  projectFileKeys,
  projectFilesQuery,
  loadProjectFiles,
  peekProjectFiles,
} from "./fileIndex";

vi.mock("../../../../platform/tauri/fs", () => ({ listProjectFiles: vi.fn() }));
const list = vi.mocked(listProjectFiles);
const files: ProjectFile[] = [
  { name: "a.ts", relative: "a.ts", path: "/repo/a.ts" },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  queryClient.clear();
  list.mockReset().mockResolvedValue(files);
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["focus", "visibilitychange"])(
  "revalidates indexes after %s",
  async (event) => {
    await loadProjectFiles("/repo/first");
    await loadProjectFiles("/repo/second");
    const observer = new QueryObserver(queryClient, {
      ...projectFilesQuery("/repo/second"), staleTime: 0, refetchOnMount: false,
    });
    const stop = observer.subscribe(() => {});
    const changed = [
      ...files,
      { name: "new.ts", relative: "new.ts", path: "/repo/new.ts" },
    ];
    list.mockResolvedValue(changed);
    (event === "focus" ? window : document).dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(queryClient.getQueryState(projectFileKeys.cwd("/repo/first"))?.isInvalidated).toBe(true);
    expect(peekProjectFiles("/repo/second")).toEqual(changed);
    expect(list).toHaveBeenCalledTimes(3);
    expect(await loadProjectFiles("/repo/first")).toEqual(changed);
    expect(list).toHaveBeenCalledTimes(4);
    stop();
  },
);

it("does not refresh or evict indexes while the window is hidden", async () => {
  await loadProjectFiles("/repo/first");
  await loadProjectFiles("/repo/second");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(peekProjectFiles("/repo/first")).toBe(files);
  expect(peekProjectFiles("/repo/second")).toBe(files);
  expect(list).toHaveBeenCalledTimes(2);
});
