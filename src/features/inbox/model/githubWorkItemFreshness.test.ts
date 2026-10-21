import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import {
  clearInboxCache,
  githubPrDiff,
  githubPrAction,
  githubWorkItemDetails,
  githubWorkItemThread,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mocked = vi.mocked(invoke);

describe("github work item freshness", () => {
  beforeEach(() => {
    queryClient.clear();
    clearInboxCache();
    mocked.mockReset();
    mocked.mockImplementation(async (command: string) =>
      command === "git_github_pr_diff"
        ? { additions: 0, deletions: 0, files: [], patch: "", truncated: false }
        : command === "git_github_work_item_thread"
          ? { comments: [], commits: [], truncated: false }
          : { body: "", author: "" },
    );
  });

  it("shares an in-flight details request", async () => {
    await Promise.all([
      githubWorkItemDetails("/repo", "o/r", "pr", 1),
      githubWorkItemDetails("/repo", "o/r", "pr", 1),
    ]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("reuses recent data only when the caller allows it", async () => {
    await githubWorkItemDetails("/repo", "o/r", "pr", 1);
    await githubWorkItemThread("/repo", "o/r", "pr", 1);
    await githubPrDiff("/repo", "o/r", 1);
    expect(mocked).toHaveBeenCalledTimes(3);

    await githubWorkItemDetails("/repo", "o/r", "pr", 1, { maxAgeMs: 30_000 });
    await githubWorkItemThread("/repo", "o/r", "pr", 1, { maxAgeMs: 30_000 });
    await githubPrDiff("/repo", "o/r", 1, { maxAgeMs: 30_000 });
    expect(mocked).toHaveBeenCalledTimes(3);

    await githubWorkItemDetails("/repo", "o/r", "pr", 1);
    expect(mocked).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["inbox", "detail", "/repo", "github:o/r:pr:1", "body"],
    ["linkPreview", "github", "/repo", "o/r", "pr", 1, "details"],
  ])("clears account-specific view data and rejects its late refresh (%s)", async (...queryKey) => {
    let finish!: (value: { body: string }) => void;
    const queryFn = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ body: "new account" });
    const initialData = { body: "old account" };
    const observer = new QueryObserver(queryClient, { queryKey, queryFn, initialData, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const pending = observer.refetch();
      queryClient.setQueryData(["inboxSource", "linear", "details", "issue"], initialData);
      clearInboxCache();
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(["inboxSource", "linear", "details", "issue"])).toBeUndefined();
      await vi.waitFor(() => expect(queryClient.getQueryData(queryKey)).toEqual({ body: "new account" }));
      finish(initialData);
      await pending;
      expect(queryClient.getQueryData(queryKey)).toEqual({ body: "new account" });
    } finally { unsubscribe(); observer.destroy(); }
  });

  it("updates matching chat link previews after a pull request action", async () => {
    const key = ["linkPreview", "github", "/repo", "o/r", "pr", 1, "item"];
    const other = ["linkPreview", "github", "/repo", "o/r", "pr", 2, "item"];
    queryClient.setQueryData(key, { state: "open" });
    queryClient.setQueryData(other, { state: "open" });
    mocked.mockResolvedValueOnce({ kind: "pr", repo: "o/r", number: 1, state: "closed" });
    await githubPrAction("/repo", "o/r", 1, "close");
    expect(queryClient.getQueryData(key)).toMatchObject({ state: "closed" });
    expect(queryClient.getQueryData(other)).toEqual({ state: "open" });
  });
});
