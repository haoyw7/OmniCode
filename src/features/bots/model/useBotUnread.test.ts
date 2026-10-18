// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBotUnread } from "./useBotUnread";
import { botCacheKey, type BotThread } from "./bots";
import { markBotRead } from "./botUnread";
import type { BotMessage } from "./botView";

let root: Root, node: HTMLDivElement;
const rpc = vi.fn();
const message = (id: string, revision: number): BotMessage => ({ id, revision, createdAt: revision, kind: "assistant", text: id });
const threads: BotThread[] = ["one", "two"].map((id) => ({ id, botId: "bot", title: id, kind: "direct", createdAt: 1, updatedAt: 1, revision: 1, lifecycle: "idle", chatRevision: 5 }));
function Counter({ rows }: { rows: BotThread[] }) {
  const activity = useBotUnread("host", rows, rpc as never, true);
  return createElement("output", null, JSON.stringify(rows.map((row) => {
    const entry = activity.get(botCacheKey("host", { botId: row.botId, threadId: row.id }));
    return { count: entry?.count, latest: entry?.latest?.id };
  })));
}
const render = () => act(async () => root.render(createElement(Counter, { rows: [...threads] })));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  rpc.mockReset().mockImplementation(async (_method, params) => ({ entries: [message(params.threadId, 5)], nextRevision: 5, hasMore: false }));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
it("loads a latest preview for already-read threads without reusing another thread's read cursor", async () => {
  localStorage.setItem(`monocode.assistant-read:${botCacheKey("host", { botId: "bot", threadId: "one" })}`, "5");
  await render();
  expect(JSON.parse(node.textContent!)).toEqual([{ count: 0, latest: "one" }, { count: 1, latest: "two" }]);
  expect(rpc.mock.calls.find(([, params]) => params.threadId === "one" && !params.latest)).toBeUndefined();
  expect(rpc.mock.calls.find(([, params]) => params.threadId === "two" && !params.latest)?.[1]).toMatchObject({ botId: "bot", afterRevision: 0 });
  act(() => markBotRead(botCacheKey("host", { botId: "bot", threadId: "two" }), [message("two", 5)]));
  expect(JSON.parse(node.textContent!)[1].count).toBe(0);
});
it("retries a failed preview on a fresh snapshot even when revisions are unchanged", async () => {
  rpc.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(JSON.parse(node.textContent!)[0]).toEqual({ count: 0 });
  await render();
  expect(JSON.parse(node.textContent!)[0]).toEqual({ count: 1, latest: "one" });
});
