import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { botRunsQuery, loadMoreBotRuns } from "./botPanelQueries";
import type { BotRpc } from "./botRpc";
import type { BotRun } from "./bots";

const scope = { botId: "bot", threadId: "thread" };
const run = (id: string, createdAt: number, status: BotRun["status"] = "running"): BotRun => ({
  ...scope, id, createdAt, status, updatedAt: createdAt, wakeupId: id, attempt: 1,
});
afterEach(() => queryClient.clear());

it("refreshes down to the oldest loaded run when new work pushes it onto another page", async () => {
  let updated = false;
  const request = vi.fn(async (_method: string, params: { before?: { createdAt: number } }) => {
    const before = params.before?.createdAt ?? Infinity;
    const rows = updated ? [run("new", 3), run("recent", 2), run("old", 1, "completed")] : [run("recent", 2), run("old", 1)];
    const value = rows.find(row => row.createdAt < before)!;
    const hasMore = value.id !== "old";
    return { revision: Number(updated), runs: [value], hasMore, next: hasMore ? { id: value.id, createdAt: value.createdAt } : undefined };
  });
  const rpc = request as BotRpc, options = botRunsQuery(rpc, scope);
  await queryClient.fetchQuery(options);
  await loadMoreBotRuns(rpc, scope);
  expect(queryClient.getQueryData(options.queryKey)?.runs.map(run => run.id)).toEqual(["recent", "old"]);
  updated = true;
  const next = await queryClient.fetchQuery(options);
  expect(next.runs.map(run => run.id)).toEqual(["new", "recent", "old"]);
  expect(next.runs.at(-1)?.status).toBe("completed");
  expect(request).toHaveBeenCalledTimes(5);
});

it("isolates identical bot IDs on different Host transports", async () => {
  const a = vi.fn(async () => ({ revision: 1, runs: [run("host-a", 1)], hasMore: false })) as BotRpc;
  const b = vi.fn(async () => ({ revision: 1, runs: [run("host-b", 1)], hasMore: false })) as BotRpc;
  await queryClient.fetchQuery(botRunsQuery(a, scope));
  expect(queryClient.getQueryData(botRunsQuery(b, scope).queryKey)).toBeUndefined();
  expect((await queryClient.fetchQuery(botRunsQuery(b, scope))).runs[0].id).toBe("host-b");
});
