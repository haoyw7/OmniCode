import { expect, it } from "vitest";
import type { BotMessage } from "./botView";
import { compactBotTimeline } from "./botTimeline";

const card = (id: string, overrides: Partial<Extract<BotMessage, { kind: "session-card" }>> = {}): BotMessage => ({
  id, revision: 1, createdAt: 1, kind: "session-card",
  ref: { environmentId: "host", projectId: "project", sessionId: "session" },
  title: "Task", projectName: "Project", harness: "codex", model: "test",
  actionId: id, status: "queued", ...overrides,
});
it("keeps the newest session card without removing surrounding messages or mutating history", () => {
  const reply: BotMessage = { id: "reply", revision: 2, createdAt: 2, kind: "assistant", text: "Following up" };
  const latest = card("new", { createdAt: 3, status: "failed", error: "Could not send" });
  const history = [card("old"), reply, latest];
  expect(compactBotTimeline(history)).toEqual([reply, latest]);
  expect(history).toHaveLength(3);
  const updated = { ...latest, status: "completed" as const, revision: 4, error: undefined };
  expect(compactBotTimeline([history[0], reply, updated])).toEqual([reply, updated]);
});
it("keeps distinct sessions even when their names or IDs match across projects and Hosts", () => {
  const history = [card("a"),
    card("b", { ref: { environmentId: "other", projectId: "project", sessionId: "session" } }),
    card("c", { ref: { environmentId: "host", projectId: "other", sessionId: "session" } }),
    card("d", { ref: { environmentId: "host", projectId: "project", sessionId: "other" } }),
  ];
  expect(compactBotTimeline(history)).toEqual(history);
});
