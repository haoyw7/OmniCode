// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";
import { setUiLanguage } from "../shared/i18n/language";
import { saveLastLocation } from "./lastLocation";
const healthyStatus = vi.hoisted(() => ({ state: "connected" as const }));

const project = vi.hoisted(() => ({
  id: "project",
  name: "Project",
  cwd: "/project",
}));
const snapshot = vi.hoisted(() => ({
  projectId: "project",
  revision: 1,
  updatedAt: 1,
  status: "idle" as const,
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
const host = vi.hoisted(() => ({
  connection: {
    endpoint: "http://computer:3774",
    name: "Computer",
    environmentId: "skills-flow",
  },
  restore: vi.fn(async () => true),
  pending: vi.fn(async () => undefined),
  savedConnections: vi.fn(async () => []),
  switchTo: vi.fn(async () => undefined),
  verify: vi.fn(async () => {}),
  getConnectionStatus: () => healthyStatus,
  hasCapability: () => false,
  subscribeConnectionStatus: () => () => {},
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
  cachedSession: () => undefined,
  sessionPreviews: async () => undefined,
  session: vi.fn(async () => snapshot),
  uploadAttachments: vi.fn(async () => []),
  skills: vi.fn(async () => ({
    native: false,
    canCompact: true,
    skills: [
      {
        kind: "file",
        name: "review",
        invocation: "review",
        description: "Review",
        path: "/project/.agents/skills/review/SKILL.md",
        source: "agents",
        scope: "project",
      },
    ],
  })),
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  setUiLanguage("en");
  saveLastLocation({
    environmentId: "skills-flow",
    projectId: "project",
    sessionId: "session",
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(MobileApp)));
  await act(async () => node.querySelector<HTMLButtonElement>('.mobile-home-session[data-session-id="session"]')!.click());
}
async function input(value: string) {
  await act(async () => {
    const field = node.querySelector("textarea")!;
    field.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.setSelectionRange(value.length, value.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  await act(async () =>
    node
      .querySelector("form.mobile-composer")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

describe("mobile skill and app-command send flow", () => {
  it("sends the original skill invocation to the existing Host journal flow", async () => {
    await render();
    await input("/rev");
    expect(host.skills).toHaveBeenCalledWith(
      "project",
      "codex",
      "session",
      true,
    );
    const item = [
      ...node.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ].find((row) => row.querySelector("strong")?.textContent === "/review")!;
    await act(async () => item.click());
    await input("/review inspect code");
    await send();
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        sessionId: "session",
        text: "/review inspect code",
      }),
      undefined,
    );
  });
  it("opens skills directly in the add menu and inserts the chosen skill into the draft", async () => {
    await render();
    await input("Inspect ");
    await act(async () => node.querySelector<HTMLButtonElement>('button[aria-label="Add to message"]')!.click());
    const item = [...node.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find(row => row.querySelector("strong")?.textContent === "/review")!;
    await act(async () => item.click());
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(node.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Inspect /review ");
    expect(document.activeElement).toBe(node.querySelector("textarea"));
    expect(host.dispatch).not.toHaveBeenCalled();
  });
  it("consumes the app Plan prefix and preserves plan intent on the Host turn", async () => {
    await render();
    await input("/plan inspect code");
    await send();
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        text: "inspect code",
        intent: "plan",
      }),
      undefined,
    );
  });
  it("uses a standalone Plan command to enable the mode without sending an empty turn", async () => {
    await render();
    await input("/plan");
    await send();
    expect(host.dispatch).not.toHaveBeenCalled();
    expect(node.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(node.querySelector('button[aria-label="Plan mode"]')).not.toBeNull();
  });
  it("dispatches Compact through the existing Host command rather than a model prompt", async () => {
    await render();
    await input("/compact");
    await send();
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "compact", sessionId: "session" }),
      undefined,
    );
    expect(node.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
  });
  it("preserves provider command escapes and arguments for Host preparation", async () => {
    await render();
    await input("/pi:compact @literal/path");
    await send();
    expect(host.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        text: "/pi:compact @literal/path",
      }),
      undefined,
    );
  });
});
