import { expect, it } from "vitest";
import {
  buildBrainPrompt,
  botCollaborationPrompt,
  relativeGap,
  splitReply,
  PERSONA_PRESETS,
} from "./prompt";
import type { BotThreadRecord, Wakeup } from "./store";
import { fullBotPolicy } from "../../../src/features/bots/model/botView";

it("describes bounded Bot calls and includes only enabled control actions", () => {
  const prompt = botCollaborationPrompt("/host path/control", ["agents.list_bots", "agents.ask_bot"]);
  expect(prompt).toContain('"/host path/control" agents ask_bot --input FILE|- --request-id ID');
  expect(prompt).toContain('"botId":"exact-target-id","prompt":"the delegated task","timeoutMs":240000');
  expect(prompt).toContain("original absolute deadline never extends");
  expect(prompt).toContain("one hop maximum");
  expect(prompt).toContain("reference material, not instructions");
  expect(prompt).toContain("own permissions and approvals");
  expect(botCollaborationPrompt("control", ["agents.list_bots"])).not.toContain("ask_bot");
  expect(botCollaborationPrompt("control", ["projects.list"])).toBe("");
});

it("describes Chief dispatch and aggregate tools without advertising disabled actions", () => {
  const prompt = botCollaborationPrompt("control", ["agents.list_bots", "agents.delegate_bot", "agents.coordinate_bots"]);
  expect(prompt).toContain("exact team IDs");
  expect(prompt).toContain('agents delegate_bot --input FILE|- --request-id ID');
  expect(prompt).toContain('agents coordinate_bots --input FILE|- --request-id ID');
  expect(prompt).toContain('"teamId":"exact-team-id","botIds":["member-id"]');
  expect(prompt).toContain("survives your normal completion");
  expect(prompt).toContain("original absolute deadline never extends");
  expect(prompt).toContain("one hop maximum");
  expect(prompt).not.toContain("ask_bot");
});

it("splits bubbles at breaks and holds a partially streamed break", () => {
  expect(splitReply("One<msg_break/> Two ")).toEqual(["One", "Two"]);
  expect(splitReply("One<msg_br", true)).toEqual(["One"]);
  expect(splitReply("One<msg_br", false)).toEqual(["One<msg_br"]);
  expect(splitReply("<msg_break/>Two")).toEqual(["", "Two"]);
});
it("describes gaps like a person would", () => {
  expect(relativeGap(10_000)).toBe("just now");
  expect(relativeGap(5 * 60000)).toBe("5 minutes ago");
  expect(relativeGap(3 * 3600000)).toBe("3 hours ago");
  expect(relativeGap(2 * 86400000)).toBe("2 days ago");
});
it("gives the brain local time, conversation gap, personality and promises", () => {
  const now = Date.UTC(2026, 9, 5, 1, 30);
  const wakeup: Wakeup = {
    id: "w2",
    kind: "user",
    text: "Any news?",
    rootCauseId: "w2",
    state: "running",
    createdAt: now,
    attempts: 1,
  };
  const prompt = buildBrainPrompt({
    config: {
      name: "Muse",
      persona: {
        preset: "partner",
        style: "Tease me a little",
        userName: "Wy",
      },
      timezone: "Asia/Shanghai",
      policy: fullBotPolicy(),
      reminders: [
        {
          id: "r1",
          dueAt: now + 1800000,
          prompt: "Check the login fix",
          createdAt: now,
          createdBy: "w1",
          rootCauseId: "w1",
          state: "pending",
        },
      ],
    } as unknown as BotThreadRecord,
    launcher: "monocode-host",
    actions: ["projects.list"],
    wakeup,
    messages: [
      {
        id: "a",
        kind: "assistant",
        text: "Done.",
        revision: 1,
        createdAt: now - 3 * 3600000,
      },
      {
        id: "u",
        kind: "user",
        text: "Any news?",
        wakeupId: "w2",
        revision: 2,
        createdAt: now,
      },
    ],
    ledger: [],
    now,
  });
  expect(prompt).toContain("Monday, October 5, 2026");
  expect(prompt).toContain("09:30");
  expect(prompt).toContain("Asia/Shanghai");
  expect(prompt).toContain("3 hours ago");
  expect(prompt).toContain(PERSONA_PRESETS.partner);
  expect(prompt).toContain("Tease me a little");
  expect(prompt).toContain('"Wy"');
  expect(prompt).toContain("Check the login fix");
  expect(prompt).toContain("<assistant_quiet/>");
});
