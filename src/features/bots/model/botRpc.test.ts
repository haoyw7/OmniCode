import { expect, it, vi } from "vitest";
import { BotClient, mergeBotMessages } from "./botRpc";
import type { BotHistory, BotMessage } from "./botView";
const message = (id: string, revision: number): BotMessage => ({
  id,
  kind: "assistant",
  text: String(revision),
  revision,
  createdAt: 1,
});
it("merges repeated incremental card revisions without duplicate bubbles", () => {
  expect(
    mergeBotMessages(
      [message("one", 1)],
      [message("one", 3), message("one", 2)],
    ),
  ).toEqual([message("one", 3)]);
});
it("retries one stable command ID even when storage is unavailable", async () => {
  const rpc = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost reply"))
    .mockResolvedValue({ accepted: true });
  const storage = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("unavailable");
    },
    removeItem() {},
  };
  const client = new BotClient("one", rpc, storage);
  await expect(client.send("hello")).rejects.toThrow(/lost reply/);
  await expect(client.send("different")).rejects.toThrow(/retrying/);
  await client.send("hello");
  expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  expect(client.pending()).toBeUndefined();
});
it("restores an outbox after reconnect while keeping Hosts independent", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const fail = vi.fn().mockRejectedValue(new Error("offline"));
  const first = new BotClient("one", fail, storage);
  await expect(first.send("pending")).rejects.toThrow(/offline/);
  const rpc = vi.fn().mockResolvedValue({ accepted: true });
  const restored = new BotClient("one", rpc, storage),
    other = new BotClient("two", rpc, storage);
  expect(restored.pending()?.text).toBe("pending");
  expect(other.pending()).toBeUndefined();
  await restored.send("pending");
  expect(rpc.mock.calls[0][1]).toEqual(fail.mock.calls[0][1]);
});
it("drains message pages in order and retains its cursor across polling", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ id: "assistant" })
    .mockResolvedValueOnce({
      entries: [message("one", 1)],
      nextRevision: 1,
      hasMore: true,
    })
    .mockResolvedValueOnce({
      entries: [message("two", 2)],
      nextRevision: 2,
      hasMore: false,
    });
  const client = new BotClient("one", rpc);
  expect((await client.sync()).messages).toHaveLength(2);
  expect(rpc.mock.calls[2][1]).toMatchObject({ afterRevision: 1 });
});
it("opens with one recent history read and skips unchanged message polls", async () => {
  const assistant = { id: "assistant", chatRevision: 1000 } as BotHistory["assistant"];
  const rpc = vi.fn().mockResolvedValueOnce({
    assistant,
    entries: [message("newest", 1000)],
    nextCursor: { createdAt: 1, id: "newest" },
    hasMore: true,
  }).mockResolvedValueOnce(assistant).mockResolvedValueOnce({ ...assistant, chatRevision: 1001 })
    .mockResolvedValueOnce({ entries: [message("newest", 1001)], nextRevision: 1001, hasMore: false });
  const client = new BotClient("recent", rpc);
  const first = await client.sync({ history: true });
  expect(first.messages).toEqual([message("newest", 1000)]);
  expect(rpc.mock.calls).toEqual([["assistant.messages", { latest: true, limit: 30 }]]);
  expect(client.hasOlderHistory).toBe(true);
  expect((await client.sync()).messages).toBe(first.messages);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect((await client.sync()).messages).toEqual([message("newest", 1001)]);
  expect(rpc.mock.calls[3]).toEqual(["assistant.messages", { afterRevision: 1000, limit: 100 }]);
});
it("keeps recent history enabled when setup finishes after an empty first read", async () => {
  const assistant = { id: "a", chatRevision: 1 } as BotHistory["assistant"];
  const rpc = vi.fn().mockResolvedValueOnce({ assistant: null, entries: [], hasMore: false })
    .mockResolvedValueOnce({ assistant, entries: [message("first", 1)], hasMore: false })
    .mockResolvedValueOnce(assistant);
  const client = new BotClient("setup", rpc);
  expect((await client.sync({ history: true })).assistant).toBeNull();
  expect((await client.sync({ fresh: true })).messages).toEqual([message("first", 1)]);
  await client.sync();
  expect(rpc.mock.calls.map(([method]) => method)).toEqual([
    "assistant.messages", "assistant.messages", "assistant.get",
  ]);
  expect(rpc.mock.calls[1][1]).toEqual({ latest: true, limit: 30 });
});
it("merges a delayed older page with live revisions without resetting the delta cursor", async () => {
  let resolveHistory!: (page: BotHistory) => void;
  const history = new Promise<BotHistory>((resolve) => { resolveHistory = resolve; });
  const assistant = { id: "assistant", chatRevision: 10 } as BotHistory["assistant"];
  const rpc = vi.fn().mockResolvedValueOnce({
    assistant, entries: [message("latest", 10)],
    nextCursor: { createdAt: 1, id: "latest" }, hasMore: true,
  }).mockReturnValueOnce(history)
    .mockResolvedValueOnce({ ...assistant, chatRevision: 11 })
    .mockResolvedValueOnce({ entries: [message("older", 11)], nextRevision: 11, hasMore: false })
    .mockResolvedValueOnce({ ...assistant, chatRevision: 11 });
  const client = new BotClient("history", rpc);
  await client.sync({ history: true });
  const pending = client.loadOlder();
  expect(client.loadOlder()).toBe(pending);
  await client.sync();
  resolveHistory({ assistant, entries: [message("older", 1)], hasMore: false });
  expect(await pending).toEqual([message("latest", 10), message("older", 11)]);
  expect(client.historyMessageIds.has("older")).toBe(true);
  expect(client.hasOlderHistory).toBe(false);
  expect((await client.sync()).messages).toEqual(await pending);
  expect(rpc).toHaveBeenCalledTimes(5);
  expect(rpc.mock.calls[1][1]).toEqual({ latest: true, before: { createdAt: 1, id: "latest" }, limit: 30 });
});
it("shares concurrent refreshes and allows a failed older page to retry", async () => {
  let resolve!: (page: BotHistory) => void;
  const rpc = vi.fn().mockReturnValueOnce(new Promise<BotHistory>((done) => { resolve = done; }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ entries: [message("old", 1)], hasMore: false });
  const client = new BotClient("concurrent", rpc);
  const first = client.sync({ history: true });
  expect(client.sync()).toBe(first);
  expect(rpc).toHaveBeenCalledTimes(1);
  resolve({ assistant: { id: "a", chatRevision: 2 } as any, entries: [message("new", 2)],
    hasMore: true, nextCursor: { createdAt: 1, id: "new" } });
  await first;
  await expect(client.loadOlder()).rejects.toThrow("offline");
  expect(client.hasOlderHistory).toBe(true);
  expect((await client.loadOlder()).map((m) => m.id)).toEqual(["new", "old"]);
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[2]);
});
it("refreshes after a mutation instead of reusing a poll that began before it", async () => {
  const assistant = { id: "a", chatRevision: 1 } as BotHistory["assistant"];
  let resolvePoll!: (view: BotHistory["assistant"]) => void;
  const rpc = vi.fn().mockResolvedValueOnce({ assistant, entries: [message("one", 1)], hasMore: false })
    .mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }))
    .mockResolvedValueOnce({ ...assistant, chatRevision: 2 })
    .mockResolvedValueOnce({ entries: [message("two", 2)], nextRevision: 2, hasMore: false });
  const client = new BotClient("mutation", rpc);
  await client.sync({ history: true });
  const poll = client.sync();
  const refreshed = client.sync({ fresh: true });
  expect(rpc).toHaveBeenCalledTimes(2);
  resolvePoll(assistant);
  expect((await poll).messages).toEqual([message("one", 1)]);
  expect((await refreshed).messages).toEqual([message("one", 1), message("two", 2)]);
  expect(rpc.mock.calls[3]).toEqual(["assistant.messages", { afterRevision: 1, limit: 100 }]);
});

it("reuses unchanged messages across empty and repeated incremental pages", () => {
  const first = message("one", 2), second = message("two", 3);
  const previous = [first, second];
  expect(mergeBotMessages(previous, [])).toBe(previous);
  expect(mergeBotMessages(previous, [message("one", 1), { ...second }])).toBe(previous);
  const updated = mergeBotMessages(previous, [message("two", 4)]);
  expect(updated).not.toBe(previous);
  expect(updated[0]).toBe(first);
  expect(updated[1]).toEqual(message("two", 4));
  expect(previous[1]).toBe(second);
});

it("reads assistant image chunks by public message without a session or Host path", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: btoa("abc"), offset: 3, size: 5 })
    .mockResolvedValueOnce({ data: btoa("de"), offset: 5, size: 5 });
  const client = new BotClient("host", rpc);
  const file = { id: "photo", name: "photo.png", kind: "image" as const, mimeType: "image/png", size: 5 };
  expect(await client.readImage("message", file)).toBe(btoa("abcde"));
  expect(rpc.mock.calls).toEqual([
    ["attachments.read", { messageId: "message", id: "photo", offset: 0 }],
    ["attachments.read", { messageId: "message", id: "photo", offset: 3 }],
  ]);
});
it.each([
  { data: "", offset: 0, size: 5 },
  { data: btoa("abc"), offset: 3, size: 6 },
  { data: btoa("ab"), offset: 2, size: 5 },
  { data: btoa("a"), offset: 3, size: 5 },
])("rejects invalid assistant image transfer metadata (%j)", async chunk => {
  const client = new BotClient("host", vi.fn().mockResolvedValue(chunk));
  await expect(client.readImage("message", {
    id: "photo", name: "photo.png", kind: "image", mimeType: "image/png", size: 5,
  })).rejects.toThrow("Invalid image transfer");
});
