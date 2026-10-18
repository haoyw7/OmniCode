import { expect, it } from "vitest";
import type { BotMessage } from "../../../src/features/bots/model/botView";
import type { Session } from "../../../src/features/sessions/model/session";
import {
  conversationBrief,
  DEFAULT_BASELINE,
  GROWTH_TOKENS,
  IDLE_ROTATE_MS,
  rotationReason,
} from "./rotation";

const brain = (
  used: number,
  window?: number,
  lastAt = 0,
): Pick<Session, "providerSessionId" | "context" | "blocks"> => ({
  providerSessionId: "p1",
  context: { used, window },
  blocks: [
    { id: "u", role: "user", text: "hi", startedAt: lastAt, durationMs: 1000 },
  ] as Session["blocks"],
});

it("rotates on context growth, a filled window, or a long break with real growth", () => {
  const now = IDLE_ROTATE_MS * 2;
  expect(rotationReason(brain(DEFAULT_BASELINE + GROWTH_TOKENS), now, undefined)).toBe("context");
  expect(rotationReason(brain(30_000, 50_000, now), now)).toBe("context");
  expect(rotationReason(brain(DEFAULT_BASELINE * 2, undefined, 0), now)).toBe("idle");
  // A short break, a barely used context, or no provider thread keeps going.
  expect(rotationReason(brain(DEFAULT_BASELINE * 2, undefined, now - 60_000), now)).toBeUndefined();
  expect(rotationReason(brain(DEFAULT_BASELINE, undefined, 0), now)).toBeUndefined();
  expect(
    rotationReason({ ...brain(500_000), providerSessionId: undefined }, now),
  ).toBeUndefined();
  // A measured baseline moves the growth budget.
  expect(rotationReason(brain(70_000), now, 5_000)).toBe("context");
});

it("briefs recent exchanges word for word and earlier ones as single lines", () => {
  let revision = 0;
  const message = (kind: "user" | "assistant", text: string) =>
    ({ id: String(revision), kind, text, revision: ++revision, createdAt: revision }) as BotMessage;
  const messages = [
    message("user", "First question\nwith detail"),
    message("assistant", "First answer"),
    message("assistant", "Event report on my own"),
    message("user", "Second question"),
    message("assistant", "Part one"),
    message("assistant", "Part two"),
    message("user", "Latest question"),
  ];
  const brief = conversationBrief(messages, (at) => `t${at}`);
  expect(brief).toContain("- t1 · User: First question with detail → You: First answer Event report on my own");
  expect(brief).toContain("User (t4):\nSecond question\n\nYou:\nPart one\nPart two");
  expect(brief).toContain("User (t7):\nLatest question");
  expect(conversationBrief([], String)).toBe("");
});
