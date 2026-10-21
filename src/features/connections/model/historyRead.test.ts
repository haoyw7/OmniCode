import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { readHistoryWindow, retainHistoryWindow } from "./historyRead";
import { HISTORY_MODE } from "../../../integrations/harness/core/history";

afterEach(() => queryClient.clear());
const tail = { revision: 1, history: { mode: HISTORY_MODE, start: "b75", hasMore: true } };

it("does not let a delayed publication shrink an expanded window at the same revision", () => {
  const short = { ...tail, session: { id: "s", blocks: [{ id: "b75" }] } };
  const expanded = { ...short, history: { ...tail.history, start: "b0" }, session: { id: "s", blocks: [{ id: "b0" }, { id: "b75" }] } };
  expect(retainHistoryWindow(expanded, short)).toBe(expanded);
  expect(retainHistoryWindow(short, expanded)).toBe(expanded);
  const rewind = { ...short, revision: 2 };
  expect(retainHistoryWindow(expanded, rewind)).toBe(rewind);
});

it("serializes a page behind polling, uses the latest cursor, and shares an active page with polling", async () => {
  let finishPoll!: (value: typeof tail) => void, finishPage!: (value: typeof tail) => void;
  const load = vi.fn((_known: typeof tail | undefined, earlier: boolean) => new Promise<typeof tail>(resolve => {
    if (earlier) finishPage = resolve; else finishPoll = resolve;
  }));
  const poll = readHistoryWindow(["host", "s"], tail, false, load);
  const older = readHistoryWindow(["host", "s"], tail, true, load);
  expect(load).toHaveBeenCalledTimes(1);
  finishPoll({ ...tail, revision: 2 }); await poll;
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(load.mock.calls[1].slice(0, 2)).toMatchObject([{ ...tail, revision: 2 }, true]);
  const joined = readHistoryWindow(["host", "s"], tail, false, load);
  const expanded = { revision: 2, history: { mode: HISTORY_MODE, start: "b0", hasMore: false } };
  finishPage(expanded);
  expect(await older).toBe(expanded);
  expect(await joined).toBe(expanded);
  expect(await readHistoryWindow(["host", "s"], tail, true, load)).toBe(expanded);
  expect(load).toHaveBeenCalledTimes(2);
});

it("cancels old connection work and never publishes its late result", async () => {
  let finish!: (value: typeof tail) => void;
  const pending = readHistoryWindow(["old", "s"], undefined, false, () => new Promise<typeof tail>(resolve => { finish = resolve; }));
  const rejected = expect(pending).rejects.toThrow();
  await queryClient.cancelQueries({ queryKey: ["sessionHistory", "old"] });
  queryClient.removeQueries({ queryKey: ["sessionHistory", "old"] });
  finish(tail); await rejected;
  expect(queryClient.getQueryData(["sessionHistory", "old", "s"])).toBeUndefined();
});
