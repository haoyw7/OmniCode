import { afterEach, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { readCompleteToolContent, removeToolContentQueries, toolContentQuery } from "./toolContentQueries";
import type { ToolContentPage, ToolContentRequest, ToolContentSource } from "../../../integrations/harness/core/toolContent";

const request: ToolContentRequest = { sessionId: "s", blockPath: ["t"], field: "output", version: "old" };
const page = (start = 0, version = "v1"): ToolContentPage => ({ sessionId: "s", blockPath: ["t"], field: "output", version, transfer: "pinned", start, end: start + 3, total: 6, text: start ? "def" : "abc" });
afterEach(() => { queryClient.clear(); onlineManager.setOnline(true); });

it("deduplicates requests by source/version and allows local reads while offline", async () => {
  onlineManager.setOnline(false);
  const source: ToolContentSource = { key: ["mobile", "host", "s"], read: vi.fn(async () => page()) };
  const query = toolContentQuery(source, request);
  await Promise.all([queryClient.fetchQuery(query), queryClient.fetchQuery(query)]);
  expect(source.read).toHaveBeenCalledTimes(1);
  await queryClient.fetchQuery(toolContentQuery(source, { ...request, version: "new" }));
  await queryClient.fetchQuery(toolContentQuery({ ...source, key: ["mobile", "other", "s"] }, request));
  expect(source.read).toHaveBeenCalledTimes(3);
  removeToolContentQueries(source.key);
  expect(queryClient.getQueryData(query.queryKey)).toBeUndefined();
});

it("copies exactly one pinned version and rejects gaps or mixed snapshots", async () => {
  const read = vi.fn(async (input: ToolContentRequest) => page(input.offset));
  expect(await readCompleteToolContent({ key: [], read }, { ...request, end: 1, tail: true })).toBe("abcdef");
  expect(read.mock.calls[1][0]).toMatchObject({ transfer: "pinned", version: "v1", offset: 3, end: undefined, tail: false });
  await expect(readCompleteToolContent({ key: [], read: async input => page(input.offset, input.offset ? "v2" : "v1") }, request)).rejects.toThrow("Incomplete");
  await expect(readCompleteToolContent({ key: [], read: async () => page(3) }, request)).rejects.toThrow("Incomplete");
});

it("stops full-copy pagination after cancellation", async () => {
  const abort = new AbortController();
  const read = vi.fn(async () => { abort.abort(); return page(); });
  await expect(readCompleteToolContent({ key: [], read }, request, abort.signal)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});

it("bounds inactive streaming versions instead of retaining every old tail", async () => {
  const source: ToolContentSource = { key: ["stream"], read: async () => page() };
  for (let revision = 0; revision < 150; revision++)
    await queryClient.fetchQuery(toolContentQuery(source, { ...request, version: String(revision) }));
  expect(queryClient.getQueryCache().findAll({ queryKey: ["toolContent"] }).length).toBeLessThanOrEqual(128);
});
