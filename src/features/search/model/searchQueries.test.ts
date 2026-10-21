import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { cancelProjectSearch, searchProject } from "./search";
import { projectSearchQuery } from "./searchQueries";

vi.mock("./search", () => ({ searchProject: vi.fn(), cancelProjectSearch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../connections/files/model/fileIndex", () => ({ loadProjectFiles: vi.fn(), peekProjectFiles: vi.fn() }));
vi.mock("../../sessions/data/sessionStore", () => ({ searchSessions: vi.fn(), cancelSessionSearch: vi.fn() }));

beforeEach(() => { queryClient.clear(); vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { queryClient.clear(); vi.useRealTimers(); });

it("cancels the debounce before starting a replaced search", async () => {
  const observer = new QueryObserver(queryClient, projectSearchQuery({ cwd: "/repo", query: "old" }));
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(100);
  stop();
  await vi.advanceTimersByTimeAsync(200);
  expect(searchProject).not.toHaveBeenCalled();
  expect(cancelProjectSearch).not.toHaveBeenCalled();
});

it("cancels the correct backend request and ignores its late reply after switching queries", async () => {
  let finish!: (value: { matches: []; truncated: boolean }) => void;
  vi.mocked(searchProject).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ matches: [], truncated: true });
  const observer = new QueryObserver(queryClient, projectSearchQuery({ cwd: "/repo", query: "old" }));
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(200);
  const request = vi.mocked(searchProject).mock.calls[0][0];
  observer.setOptions(projectSearchQuery({ cwd: "/repo", query: "new" }));
  expect(cancelProjectSearch).toHaveBeenCalledExactlyOnceWith("/repo", request.searchId);
  await vi.advanceTimersByTimeAsync(200);
  finish({ matches: [], truncated: false });
  await Promise.resolve();
  expect(observer.getCurrentResult().data?.truncated).toBe(true);
  stop();
});
