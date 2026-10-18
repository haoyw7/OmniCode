import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";
import { setUiLanguage } from "../shared/i18n/language";
import { loadTranscriptAnchor } from "../features/settings/model/appearance";
import {
  loadFollowUpBehavior,
  saveFollowUpBehavior,
} from "../features/settings/model/settings";

const project = vi.hoisted(() => ({
  id: "project",
  name: "Project",
  cwd: "/project",
}));
const snapshot = vi.hoisted(() => ({
  projectId: "project",
  revision: 1,
  updatedAt: 1,
  status: "running" as const,
  runId: "active-turn",
  supportsQueue: true,
  canSteer: true,
  session: {
    id: "session",
    title: "Conversation",
    harness: "codex" as const,
    cwd: "/project",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    blocks: [],
  },
}));
const healthyStatus = vi.hoisted(() => ({ state: "connected" as const }));
const host = vi.hoisted(() => ({
  connection: {
    endpoint: "http://computer:3774",
    name: "Computer",
    environmentId: "follow-up-settings",
  },
  getConnectionStatus: () => healthyStatus,
  hasCapability: () => false,
  subscribeConnectionStatus: () => () => {},
  restore: vi.fn(async () => true),
  verify: vi.fn(async () => {}),
  pending: vi.fn(async () => undefined),
  savedConnections: vi.fn(async () => []),
  switchTo: vi.fn(async () => undefined),
  projects: vi.fn(async () => [project]),
  sessions: vi.fn(async () => [
    { ...snapshot, id: "session", title: "Conversation", harness: "codex" },
  ]),
  models: vi.fn(async () => ({
    models: {
      codex: [{ id: "codex:test", name: "Test model", harness: "codex" }],
    },
    errors: {},
  })),
  cachedModels: () => undefined,
  providerAccounts: vi.fn(async () => ({})),
  cachedSession: () => undefined,
  sessionPreviews: async () => undefined,
  session: vi.fn(async () => snapshot),
  uploadAttachments: vi.fn(async () => []),
  dispatch: vi.fn(async (command: { commandId: string }) => ({
    commandId: command.commandId,
    sessionId: "session",
    revision: 2,
  })),
}));
vi.mock("./client", () => ({
  MobileClient: vi.fn(function () {
    return host;
  }),
}));
vi.mock("./MobileAppUpdates", () => ({
  useMobileAppUpdates: () => ({}),
  MobileAppUpdates: () => null,
}));
vi.mock("./useMobileActivity", () => ({
  useMobileActivity: () => ({
    unreadIds: new Set(),
    permission: "unsupported",
    enabled: false,
  }),
}));

let root: Root, node: HTMLDivElement;
beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  stopMotionClock();
  act(() => root.unmount());
  node.remove();
  localStorage.clear();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(MobileApp)));
}
async function openSettings() {
  // Settings lives at the foot of the drawer.
  await act(async () =>
    node.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click(),
  );
  await act(async () =>
    node.querySelector<HTMLButtonElement>(".mobile-drawer-settings")!.click(),
  );
  await act(async () => vi.dynamicImportSettled());
  await act(async () =>
    node.querySelector<HTMLButtonElement>('[aria-label="Message composer"]')!.click(),
  );
}
function activeDialog() {
  return node.querySelector<HTMLElement>(
    '.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]',
  );
}
async function choose(label: string) {
  await advanceMotionTimers(300);
  await act(async () => {
    [...activeDialog()!.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((button) => button.textContent === label)!
      .click();
  });
}
async function input(value: string) {
  await act(async () => {
    const field = node.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("mobile composer settings", () => {
  it("can disable prompt anchoring, remembers it after remount and translates the switch", async () => {
    await render();
    await openSettings();
    const toggle = () =>
      node.querySelector<HTMLInputElement>("#mobile-transcript-anchor")!;
    expect(toggle().checked).toBe(true);
    await act(async () => toggle().click());
    expect(toggle().checked).toBe(false);
    expect(loadTranscriptAnchor()).toBe(false);

    act(() => root.unmount());
    root = createRoot(node);
    await render();
    await openSettings();
    expect(toggle().checked).toBe(false);
    await act(async () => setUiLanguage("zh-CN"));
    expect(toggle().getAttribute("aria-label")).toBe("将提示词固定到顶部");
    expect(node.querySelector("#mobile-transcript-anchor-description")?.textContent)
      .toContain("让最新消息显示在输入框上方");
    await act(async () => toggle().click());
    expect(toggle().checked).toBe(true);
    expect(loadTranscriptAnchor()).toBe(true);
  });

  it("remembers the selected preference, translates the group and options, and preserves selection after remount", async () => {
    await render();
    await openSettings();
    expect(
      node.querySelector(
        '.mobile-settings-group[aria-label="Message composer"]',
      ),
    ).not.toBeNull();
    const select = () =>
      node.querySelector<HTMLButtonElement>("#mobile-follow-up")!;
    expect(select().textContent).toBe("Steer");
    await act(async () => select().click());
    await choose("Queue");
    expect(loadFollowUpBehavior()).toBe("queue");
    expect(select().textContent).toBe("Queue");
    expect(activeDialog()).toBeNull();
    expect(
      node
        .querySelector('.mobile-sheet-backdrop[data-fold-state="closing"]')
        ?.hasAttribute("inert"),
    ).toBe(true);
    act(() => root.unmount());
    root = createRoot(node);
    await render();
    await openSettings();
    expect(select().textContent).toBe("Queue");
    await act(async () => select().click());
    await act(async () => setUiLanguage("zh-CN"));
    expect(
      node.querySelector('.mobile-settings-group[aria-label="编写器"]'),
    ).not.toBeNull();
    expect(activeDialog()!.getAttribute("aria-label")).toBe("后续消息行为");
    expect(
      [...activeDialog()!.querySelectorAll('[role="radio"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(["排队", "引导"]);
    expect(
      activeDialog()!.querySelector('[aria-checked="true"]')?.textContent,
    ).toBe("排队");
    await choose("引导");
    expect(loadFollowUpBehavior()).toBe("steer");
  });

  it("opens from the keyboard, cancels without changing the preference and animates dismissal", async () => {
    saveFollowUpBehavior("queue");
    await render();
    await openSettings();
    const select = node.querySelector<HTMLButtonElement>("#mobile-follow-up")!;
    await act(async () => {
      select.focus();
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const dialog = activeDialog()!;
    expect(dialog.querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Queue",
    );
    await act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(activeDialog()).toBeNull();
    expect(document.activeElement).toBe(select);
    expect(loadFollowUpBehavior()).toBe("queue");
    const backdrop = dialog.closest(".mobile-sheet-backdrop")!;
    expect(backdrop.getAttribute("data-fold-state")).toBe("closing");
    await advanceMotionTimers(600);
    expect(node.contains(dialog)).toBe(false);
  });

  it.each(["queue", "steer"] as const)(
    "applies a live change to %s to the next running-session send",
    async (behavior) => {
      saveFollowUpBehavior(behavior === "queue" ? "steer" : "queue");
      await render();
      await openSettings();
      await act(async () =>
        node.querySelector<HTMLButtonElement>("#mobile-follow-up")!.click(),
      );
      await choose(behavior === "queue" ? "Queue" : "Steer");
      await act(async () =>
        node.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click(),
      );
      expect(node.querySelector('[aria-label="Message composer"] .mobile-settings-value')?.textContent)
        .toBe(behavior === "queue" ? "Queue" : "Steer");
      await act(async () =>
        node.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click(),
      );
      await act(async () =>
        node
          .querySelector<HTMLButtonElement>(
            '.mobile-home-session[data-session-id="session"]',
          )!
          .click(),
      );
      await input("Use this next");
      await act(async () =>
        node
          .querySelector("form.mobile-composer")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(host.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "send",
          sessionId: "session",
          text: "Use this next",
          followUpBehavior: behavior,
        }),
        undefined,
      );
      expect(node.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
        "",
      );
    },
  );
});
