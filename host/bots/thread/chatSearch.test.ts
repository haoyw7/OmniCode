import { expect, it } from "vitest";
import type { BotMessage } from "../../../src/features/bots/model/botView";
import { searchChat } from "./chatSearch";
import { buildBrainPrompt } from "./prompt";

const day = (d: number, hour = 12) => Date.UTC(2026, 9, d, hour);
const chat = (
  kind: "user" | "assistant",
  text: string,
  createdAt: number,
): BotMessage => ({
  id: `${kind}:${createdAt}`,
  kind,
  text,
  revision: createdAt,
  createdAt,
});
const messages = [
  chat("user", "放一首读心术", day(7)),
  chat("assistant", "好，正在播放卓文萱的《读心术》。", day(7, 13)),
  chat("user", "部署流程是怎样的", day(8)),
  chat("assistant", "先合并再发布到 staging", day(8, 13)),
  chat("user", "我最喜欢的歌是之前让你放过的一首三个字的歌", day(9)),
];

it("finds earlier requests by literal terms with the reply they received", () => {
  expect(searchChat(messages, "放 读心术", { timeZone: "UTC" })[0]).toEqual({
    at: "2026-10-07 12:00",
    from: "user",
    text: "放一首读心术",
    context: { from: "assistant", text: "好，正在播放卓文萱的《读心术》。" },
  });
  expect(
    searchChat(messages, "staging", { timeZone: "UTC" })[0].context,
  ).toEqual({ from: "user", text: "部署流程是怎样的" });
});

it("lists a period without a query and respects the context cutoff", () => {
  expect(
    searchChat(messages, "", { timeZone: "UTC", since: "2026-10-08" }).map(
      (hit) => hit.text,
    ),
  ).toEqual([
    "部署流程是怎样的",
    "先合并再发布到 staging",
    "我最喜欢的歌是之前让你放过的一首三个字的歌",
  ]);
  expect(
    searchChat(messages, "读心术", { timeZone: "UTC", before: day(7, 13) }),
  ).toHaveLength(1);
  expect(() => searchChat(messages, " ", { timeZone: "UTC" })).toThrow();
});

it("shows automatic recall to the brain only when hits share enough words", () => {
  const recall = searchChat(messages, "再放一次读心术", {
    timeZone: "UTC",
    before: day(9),
    minWords: 2,
  });
  expect(recall.map((hit) => hit.text)).toEqual([
    "放一首读心术",
    "好，正在播放卓文萱的《读心术》。",
  ]);
  expect(
    searchChat(messages, "发布", { timeZone: "UTC", minWords: 2 }),
  ).toEqual([]);
  const prompt = buildBrainPrompt({
    config: {
      name: "Ada",
      policy: {},
      timezone: "UTC",
    } as Parameters<typeof buildBrainPrompt>[0]["config"],
    launcher: "monocode-host",
    actions: ["chat.search"],
    wakeup: {
      id: "w",
      kind: "user",
      text: "再放一次读心术",
      rootCauseId: "w",
      state: "running",
      createdAt: day(9),
      attempts: 0,
    },
    messages,
    ledger: [],
    now: day(9),
    recall,
  });
  expect(prompt).toContain(
    "Possibly related earlier chat (found automatically; ignore it if unrelated):\n- 2026-10-07 12:00 User: 放一首读心术\n  You replied: 好，正在播放卓文萱的《读心术》。",
  );
});
