// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderTarget, SessionReminder } from "../../../contracts/reminders";
import { useSessionReminders } from "./useSessionReminders";
import { updateNotificationPreferences } from "../model/notificationPreferences";

const REMINDER_OPEN = "omnicode:reminder-open";
const { invoke, listen, message, host, notificationsEnabled } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  message: vi.fn(),
  host: { list: vi.fn(), set: vi.fn(), clear: vi.fn(), claim: vi.fn() },
  notificationsEnabled: { value: false },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message }));
vi.mock("../../sessions/model/sessionReminders", () => ({
  REMINDERS_CHANGED: "omnicode:reminders-changed",
  listReminders: host.list,
  setReminders: host.set,
  clearReminders: host.clear,
  claimDueReminders: host.claim,
}));
vi.mock("../../settings/model/sounds", () => ({
  loadSoundsEnabled: () => false,
  SOUNDS_CHANGE_EVENT: "sounds-change",
}));
vi.mock("../model/notifications", () => ({
  loadNotificationsEnabled: () => notificationsEnabled.value,
  NOTIFICATIONS_CHANGE_EVENT: "notifications-change",
}));

let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useSessionReminders>;
let stored: SessionReminder[];
let pending: ReminderTarget | null;
let listeners: Map<string, Set<() => void>>;
const onOpen = vi.fn();
const ensureSaved = vi.fn();
const reminder: SessionReminder = {
  sessionId: "saved-session",
  dueAt: 100,
  firedAt: null,
  title: "Continue this work",
  harness: "codex",
  cwd: "/another-project",
};

function Harness() {
  api = useSessionReminders(onOpen, ensureSaved, ["current-session"]);
  return null;
}

const banners = () => invoke.mock.calls.filter(([command]) => command === "show_notification");
// Delivery marks the Host claim; display and actions do not depend on it.
const visible = (items: SessionReminder[]) => items.map(({ firedAt: _fired, ...item }) => item);

async function mount() {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(Harness))),
  );
}

async function emit(event: string) {
  await act(async () => {
    listeners.get(event)?.forEach((listener) => listener());
  });
}

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  notificationsEnabled.value = false;
  stored = [{ ...reminder }];
  pending = null;
  listeners = new Map();
  onOpen.mockReset().mockResolvedValue(undefined);
  ensureSaved.mockReset().mockResolvedValue(undefined);
  message.mockReset();
  host.list.mockReset().mockImplementation(async () => ({
    reminders: stored.map((item) => ({ ...item })),
    nextDueAt: stored
      .filter((item) => item.firedAt === null)
      .reduce<number | null>((min, item) => (min === null || item.dueAt < min ? item.dueAt : min), null),
  }));
  host.set.mockReset().mockImplementation(async (ids: string[], dueAt: number) => {
    stored = ids.map((id) => ({ ...reminder, sessionId: id, dueAt, firedAt: null }));
  });
  host.clear.mockReset().mockImplementation(async (ids: string[], expected?: number) => {
    stored = stored.filter((item) => !ids.includes(item.sessionId) || (expected != null && item.dueAt !== expected));
  });
  // Host claims durably: a reminder is returned to exactly one caller.
  host.claim.mockReset().mockImplementation(async (ids: string[]) => {
    const due = stored.filter((item) => item.firedAt === null && item.dueAt <= Date.now() && ids.includes(item.sessionId));
    for (const item of due) item.firedAt = Date.now();
    return due.map((item) => ({ ...item }));
  });
  invoke
    .mockReset()
    .mockImplementation(async (command: string, args: Record<string, any> = {}) => {
      if (command === "reminder_take_open") {
        const request = pending;
        pending = null;
        return request;
      }
      if (command === "reminder_open") pending = { sessionId: args.sessionId, dueAt: args.dueAt };
    });
  listen
    .mockReset()
    .mockImplementation(async (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => listeners.get(event)?.delete(handler);
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("saved session reminders", () => {
  it("applies a path-based project mute without discovery", async () => {
    updateNotificationPreferences(["local:/another-project"], { mutedUntil: null });
    notificationsEnabled.value = true;
    await mount();
    expect(api.due).toEqual([]);
    // The muted reminder is claimed so it never replays, but shows no banner.
    expect(host.claim).toHaveBeenCalledWith([reminder.sessionId]);
    expect(banners()).toEqual([]);
    expect(visible(api.reminders)).toEqual(visible([reminder]));
  });

  it("keeps reminders actionable even when a project path no longer exists", async () => {
    const unavailable = { ...reminder, sessionId: "unavailable-session", cwd: "/deleted-worktree" };
    stored = [{ ...reminder }, unavailable];
    await mount();
    expect(visible(api.reminders)).toEqual(visible([reminder, unavailable]));
    expect(visible(api.due)).toEqual(visible([reminder, unavailable]));
    expect(api.error).toBeNull();
    await act(async () => api.cancel([unavailable.sessionId]));
    expect(visible(api.reminders)).toEqual(visible([reminder]));
    expect(api.error).toBeNull();
  });

  it("claims due reminders through Host once and shows one banner", async () => {
    notificationsEnabled.value = true;
    await mount();
    expect(banners()).toHaveLength(1);
    expect(banners()[0][1]).toMatchObject({
      sessionId: `reminder:${reminder.sessionId}:${reminder.dueAt}`,
      title: "OmniCode",
      subtitle: reminder.title,
      sound: false,
    });
    // Another refresh, window or restart finds it already claimed.
    await act(async () => {
      window.dispatchEvent(new Event("omnicode:reminders-changed"));
    });
    await focus();
    expect(banners()).toHaveLength(1);
  });

  it("wakes at the Host's next due time without waiting for the refresh interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      notificationsEnabled.value = true;
      stored = [{ ...reminder, dueAt: Date.now() + 5_000 }];
      await mount();
      expect(banners()).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });
      expect(banners()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies reminder category changes immediately without replaying an old due reminder on resume", async () => {
    await mount();
    expect(visible(api.due)).toEqual(visible([reminder]));
    await act(async () =>
      updateNotificationPreferences(["local:/another-project"], { disabled: ["reminders"] }),
    );
    expect(api.due).toEqual([]);
    await act(async () =>
      updateNotificationPreferences(["local:/another-project"], { disabled: [] }),
    );
    expect(api.due).toEqual([]);
  });

  it("shows missed reminders on startup even with desktop notifications off", async () => {
    await mount();
    expect(visible(api.due)).toEqual(visible([reminder]));
    expect(banners()).toEqual([]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("saves the conversation before scheduling and does not claim success on failure", async () => {
    await mount();
    ensureSaved.mockRejectedValueOnce(new Error("Save failed"));
    await act(async () => api.schedule([reminder.sessionId], Date.now() + 60_000));
    expect(host.set).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledWith("Error: Save failed", expect.anything());
    expect(visible(api.reminders)).toEqual(visible([reminder]));
    await act(async () => api.schedule([reminder.sessionId], Date.now() + 60_000));
    expect(api.due).toEqual([]);
    expect(ensureSaved).toHaveBeenCalledWith([reminder.sessionId]);
  });

  it("routes opening through the shell, then loads the saved session and clears its due reminder", async () => {
    await mount();
    await act(async () => api.open(reminder));
    expect(onOpen).not.toHaveBeenCalled();
    await emit(REMINDER_OPEN);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(reminder.sessionId);
    expect(host.clear).toHaveBeenCalledWith([reminder.sessionId], reminder.dueAt);
    expect(api.due).toEqual([]);
  });

  it("dismisses the current due reminder when its session continues", async () => {
    await mount();
    await act(async () => api.dismissDue(reminder.sessionId));
    expect(host.clear).toHaveBeenCalledWith([reminder.sessionId], reminder.dueAt);
    expect(api.due).toEqual([]);
  });

  it("keeps a future reminder when its session continues early", async () => {
    stored = [{ ...reminder, dueAt: Date.now() + 60_000 }];
    await mount();
    await act(async () => api.dismissDue(reminder.sessionId));
    expect(host.clear).not.toHaveBeenCalled();
    expect(api.reminders).toEqual(stored);
  });

  it("handles a notification click queued before the window mounted", async () => {
    pending = reminder;
    await mount();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(reminder.sessionId);
    expect(api.due).toEqual([]);
  });

  it("keeps the reminder if opening the session fails", async () => {
    onOpen.mockRejectedValue(new Error("Unavailable"));
    pending = reminder;
    await mount();
    expect(visible(api.due)).toEqual(visible([reminder]));
    expect(host.clear).not.toHaveBeenCalled();
  });

  it("updates when another window cancels and removes subscriptions on unmount", async () => {
    await mount();
    stored = [];
    await focus();
    expect(api.reminders).toEqual([]);
    act(() => root.unmount());
    expect(listeners.get(REMINDER_OPEN)?.size).toBe(0);
    root = createRoot(container);
  });
});
