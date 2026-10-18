// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  announceSessionFinished,
  notifySession,
  notifyApp,
  saveNotificationsEnabled,
  setWindowFocused,
} from "./notifications";
import { updateNotificationPreferences } from "./notificationPreferences";
import { newSession } from "../../sessions/model/session";

const { invoke, play } = vi.hoisted(() => ({ invoke: vi.fn(), play: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("cuelume", () => ({ play, setEnabled: vi.fn(), setVolume: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  play.mockClear();
  invoke.mockResolvedValue(undefined);
  saveNotificationsEnabled(true);
  setWindowFocused(false);
});

it("delivers assistant notifications outside projects while honoring global settings and focus", async () => {
  const text = { title: "OmniCode", subtitle: "Personal assistant", body: "Done" };
  setWindowFocused(true);
  expect(await notifyApp("assistant:host", text, true)).toBe(false);
  expect(await notifyApp("assistant:host", text, false)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("show_notification", expect.objectContaining({
    sessionId: "assistant:host", ...text,
  }));
  invoke.mockClear();
  saveNotificationsEnabled(false);
  setWindowFocused(false);
  expect(await notifyApp("assistant:host", text, false)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  saveNotificationsEnabled(true);
  expect(await notifyApp("assistant:host", text, true)).toBe(true);
});

it("returns false without a banner or sound for a non-project path", async () => {
  const sent = await notifySession(
    newSession("claude", "/"),
    "finished",
    false,
  );

  expect(sent).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("finishes without a banner or sound for a non-project path", async () => {
  await expect(
    announceSessionFinished(
      newSession("claude", "/"),
      false,
    ),
  ).resolves.toBeUndefined();

  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("blocks every project banner, including approvals and questions, while muted", async () => {
  updateNotificationPreferences(["local:/private"], {
    mutedUntil: null,
  });
  const session = newSession("claude", "/private");
  expect(await notifySession(session, "finished", false)).toBe(false);
  expect(
    await notifySession(session, { kind: "approval", requestId: 1 }, false),
  ).toBe(false);
  expect(
    await notifySession(session, { kind: "question", requestId: 2 }, false),
  ).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "show_notification"),
  ).toEqual([]);
});

it("does not deliver an input event observed during a mute after expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    updateNotificationPreferences(["local:/private"], {
      mutedUntil: 2000,
    });
    const sent = notifySession(
      newSession("claude", "/private"),
      { kind: "question", requestId: 1 },
      false,
    );
    vi.setSystemTime(3000);
    expect(await sent).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
