import { expect, it, vi } from "vitest";
import type { TurnOrigin } from "../../../contracts/session";
import { resolveBotOrigin } from "./botOrigin";

const origin: TurnOrigin = { kind: "assistant", assistantId: "legacy", botId: "bot", threadId: "thread", assistantName: "Same name", actionId: "send", wakeupId: "wake" };
const bot = { id: "bot", name: "Renamed", defaultThreadId: "default" };
const threads = [{ id: "thread", botId: "bot" }, { id: "default", botId: "bot" }];
const snapshot = { bots: [bot, { id: "other", name: "Same name", defaultThreadId: "other-thread" }], threads, defaultBotId: "bot", defaultThreadId: "default" };
const rpcFor = (value = snapshot) => vi.fn().mockResolvedValueOnce({ capabilities: ["bots.v1"] }).mockResolvedValueOnce(value);

it("opens the originating Bot and thread by ID even after a rename", async () => {
  expect(await resolveBotOrigin(origin, rpcFor())).toEqual({ bot, threadId: "thread", defaultScope: false });
});

it("resolves older messages without Bot/Thread fields to their assistant's default thread", async () => {
  expect(await resolveBotOrigin({ ...origin, assistantId: "bot", botId: undefined, threadId: undefined }, rpcFor()))
    .toEqual({ bot, threadId: "default", defaultScope: true });
});

it.each(["missing bot", "missing thread", "archived bot", "archived thread", "foreign thread"])("rejects %s without choosing another Bot", async kind => {
  const value = { ...snapshot,
    bots: kind === "missing bot" ? [] : snapshot.bots.map(item => ({ ...item, archivedAt: kind === "archived bot" ? 1 : undefined })),
    threads: threads.map(item => ({ ...item,
      id: kind === "missing thread" ? "gone" : item.id,
      botId: kind === "foreign thread" ? "other" : item.botId,
      archivedAt: kind === "archived thread" ? 1 : undefined,
    })),
  };
  await expect(resolveBotOrigin(origin, rpcFor(value))).rejects.toThrow("Unavailable Bot");
});

it("supports legacy Hosts only when the assistant identity matches", async () => {
  const rpc = () => vi.fn().mockResolvedValueOnce({ capabilities: ["assistant.v1"] }).mockResolvedValueOnce(bot);
  expect(await resolveBotOrigin(origin, rpc())).toEqual({ bot, threadId: undefined, defaultScope: true });
  await expect(resolveBotOrigin({ ...origin, botId: "gone" }, rpc())).rejects.toThrow("Unavailable Bot");
});
