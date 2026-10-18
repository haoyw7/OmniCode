// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import type { BotMessage } from "./botView";
import {
  botNotificationActivity,
  BotNotificationTracker,
  takeBotNotification,
} from "./botNotifications";

const reply = (revision: number, streaming = false): BotMessage => ({
  id: "reply", kind: "assistant", text: "Done.\n\nDetails", revision, createdAt: 1, streaming,
});
const snapshot = (revision: number, messages: BotMessage[]) =>
  botNotificationActivity({ id: "assistant", name: "My assistant", chatRevision: revision }, messages)!;
beforeEach(() => localStorage.clear());

it("waits for completion, excludes internal messages, and clips only the notification preview", () => {
  expect(snapshot(1, [reply(1, true)]).latest).toBeUndefined();
  const message = reply(2);
  expect(snapshot(3, [message, { ...reply(3), kind: "status" }]).latest)
    .toEqual({ id: "reply", revision: 2, kind: "reply", text: "Done." });
  expect(message.text).toBe("Done.\n\nDetails");
  expect(snapshot(4, [{ ...reply(4), text: "", attachments: [{ id: "a", name: "image", kind: "image", size: 1, mimeType: "image/png" }] }]).latest?.kind).toBe("reply");
});

it("baselines history and alerts once when a stream finishes, even after metadata updates", () => {
  const tracker = new BotNotificationTracker();
  expect(tracker.observe(snapshot(1, [reply(1, true)]))).toBeUndefined();
  expect(tracker.observe(snapshot(2, [reply(2, true)]))).toBeUndefined();
  expect(tracker.observe(snapshot(3, [reply(3)]))?.text).toBe("Done.");
  expect(tracker.observe(snapshot(4, [reply(3)]))).toBeUndefined();
  expect(tracker.observe(snapshot(2, [reply(2)]))).toBeUndefined();
  expect(tracker.observe(snapshot(5, [reply(5)]))).toBeUndefined();
});

it("notifies new pending inputs without replaying a reply when an input resolves", () => {
  const tracker = new BotNotificationTracker();
  tracker.observe(snapshot(1, [reply(1)]));
  const input: BotMessage = { id: "input", revision: 2, createdAt: 2, kind: "input", text: "Allow?", resolved: false,
    inputKind: "approval", brainGeneration: 1, runId: "run", requestId: 1 };
  expect(tracker.observe(snapshot(2, [reply(1), input]))?.kind).toBe("input");
  expect(tracker.observe(snapshot(3, [reply(1), { ...input, resolved: true, revision: 3 }]))).toBeUndefined();
  expect(tracker.observe(snapshot(4, [{ ...input, id: "question", inputKind: "question", revision: 4 }]))?.kind).toBe("input");
});

it("persists claims across receivers and keeps Hosts isolated without replaying muted updates", () => {
  expect(takeBotNotification("one", snapshot(1, [reply(1)]))).toBeUndefined();
  expect(takeBotNotification("two", snapshot(1, [reply(1)]))).toBeUndefined();
  const next = snapshot(2, [{ ...reply(2), id: "next" }]);
  expect(takeBotNotification("one", next)?.id).toBe("next");
  expect(takeBotNotification("one", next)).toBeUndefined();
  expect(takeBotNotification("two", next)?.id).toBe("next");
  expect(takeBotNotification("one", snapshot(3, [{ ...reply(2), id: "next" }]))).toBeUndefined();
});
