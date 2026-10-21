import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { remoteRequest } from "./connections";
import { remoteSessionCatalogQuery } from "./remoteSessionQueries";
import type { HostModelCatalog } from "./protocol";

vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));

const codex = { id: "codex:old", harness: "codex" as const, name: "Old Codex" };
const pi = { id: "pi:old", harness: "pi" as const, name: "Old Pi" };
const cached: HostModelCatalog = { models: { codex: [codex], pi: [pi] }, errors: {} };

beforeEach(() => {
  queryClient.clear();
  vi.useFakeTimers();
  vi.mocked(remoteRequest).mockReset().mockResolvedValue(cached);
});
afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

it("reuses a fresh catalog across focus changes and pane remounts, then revalidates after a minute", async () => {
  const options = remoteSessionCatalogQuery("machine", "env", "project");
  await queryClient.fetchQuery(options);
  const observer = new QueryObserver(queryClient, options);
  let stop = observer.subscribe(() => {});
  try {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      queryClient.getQueryCache().onFocus();
    }
    stop();
    stop = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(35_001);
    queryClient.getQueryCache().onFocus();
    queryClient.getQueryCache().onFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});

it("refreshes explicitly while fresh and retains cached rows throughout progressive updates", async () => {
  const updatedCodex = { ...codex, id: "codex:new", name: "New Codex" };
  vi.mocked(remoteRequest)
    .mockResolvedValueOnce(cached)
    .mockResolvedValueOnce({ models: {}, errors: {}, pending: ["codex", "pi"] })
    .mockResolvedValueOnce({ models: { codex: [updatedCodex] }, errors: { pi: "Offline" }, pending: [] });
  const options = remoteSessionCatalogQuery("machine", "env", "project");
  await queryClient.fetchQuery(options);
  const observer = new QueryObserver(queryClient, options);
  const stop = observer.subscribe(() => {});
  try {
    const refreshing = queryClient.invalidateQueries({ queryKey: options.queryKey });
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual({ ...cached, pending: ["codex", "pi"] });
    await vi.advanceTimersByTimeAsync(500);
    await refreshing;
    expect(observer.getCurrentResult().data).toEqual({
      models: { codex: [updatedCodex], pi: [pi] }, errors: { pi: "Offline" }, pending: [],
    });
    expect(remoteRequest).toHaveBeenLastCalledWith("machine", "models.list", {
      projectId: "project", progressive: true, providers: ["codex", "pi"],
    });
  } finally { stop(); }
});

it("keeps cached rows and ends the pending state when a background poll loses its connection", async () => {
  vi.mocked(remoteRequest)
    .mockResolvedValueOnce(cached)
    .mockResolvedValueOnce({ models: {}, errors: {}, pending: ["codex", "pi"] })
    .mockRejectedValueOnce(new Error("Connection lost"));
  const options = remoteSessionCatalogQuery("machine", "env", "project");
  await queryClient.fetchQuery(options);
  const observer = new QueryObserver(queryClient, options);
  const stop = observer.subscribe(() => {});
  try {
    const refreshing = queryClient.invalidateQueries({ queryKey: options.queryKey });
    await vi.advanceTimersByTimeAsync(500);
    await refreshing;
    expect(observer.getCurrentResult().data).toEqual({ ...cached, pending: [] });
    expect(observer.getCurrentResult().error?.message).toBe("Connection lost");
  } finally { stop(); }
});
