// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { MobileApp } from "./MobileApp";
import type { Connection, MobileClient } from "./client";
import { setUiLanguage } from "../shared/i18n/language";
import { fullBotPolicy as fullAssistantPolicy, type BotMessage as AssistantMessage, type BotConfiguration as AssistantView } from "../features/bots/model/botView";

const fixture = vi.hoisted(() => ({
  values: new Map<string, string>(),
  request: vi.fn(),
  client: undefined as MobileClient | undefined,
  appListener: vi.fn(async (_event: string, _callback: (state: { isActive: boolean }) => void) => ({ remove: async () => {} })),
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: fixture.appListener, exitApp: vi.fn() } }));
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, MobileClient: class extends actual.MobileClient {
    constructor() {
      super({
        get: async (key) => fixture.values.get(key) ?? null,
        set: async (key, value) => { fixture.values.set(key, value); },
        remove: async (key) => { fixture.values.delete(key); },
      }, async (endpoint, _token, input) => fixture.request(endpoint, input));
      fixture.client = this;
    }
  } };
});
vi.mock("./useMobileActivity", () => ({
  useMobileActivity: () => ({ unreadIds: new Set(), markUnread: vi.fn(), permission: "unsupported", enabled: false }),
}));
vi.mock("./MobileAppUpdates", () => ({ useMobileAppUpdates: () => ({}) }));
vi.mock("./MobileTranscript", () => ({ MobileTranscript: () => createElement("p", {}, "Transcript") }));
vi.mock("./MobileComposer", () => ({ MobileComposer: ({ value, onChange }: {
  value: string; onChange: (value: string) => void;
}) => createElement("textarea", { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }) }));

const a: Connection = { environmentId: "a", name: "Device A", endpoint: "http://a", token: "a-token" };
const b: Connection = { environmentId: "b", name: "Device B", endpoint: "http://b", token: "b-token" };
const project = { id: "shared-project", name: "Project", cwd: "/project" };
const summary = (host: string) => ({
  id: "shared-session", projectId: project.id, title: `${host} conversation`, harness: "codex",
  status: "idle", revision: 1, updatedAt: 100,
});
function respond(endpoint: string, { method }: { method: string }) {
  const host = endpoint === a.endpoint ? a : b;
  if (method === "environment.describe") return {
    protocolVersion: 1, environmentId: host.environmentId, name: host.name, providers: ["codex"],
  };
  if (method === "projects.list") return [{ ...project, name: `${host.name} project` }];
  if (method === "sessions.list") return [summary(host.name)];
  if (method === "sessions.get") return {
    projectId: project.id, revision: 1, updatedAt: 100, status: "idle",
    session: { id: "shared-session", title: `${host.name} conversation`, harness: "codex", cwd: project.cwd,
      model: "codex:model", modelSettings: {}, runtimeMode: "supervised", blocks: [] },
  };
  if (method === "models.list") return { models: { codex: [{ id: "codex:model", name: "Model", harness: "codex" }] }, errors: {} };
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let node: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await fixture.client!.disconnect();
  fixture.values.clear();
  fixture.values.set("connection", JSON.stringify(a));
  fixture.values.set("connections", JSON.stringify([a, b]));
  fixture.request.mockReset().mockImplementation(respond);
  fixture.appListener.mockClear();
  localStorage.clear();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const active = (selector: string) => [...node.querySelectorAll<HTMLElement>(selector)]
  .find((element) => !element.closest('[inert], [aria-hidden="true"]'));
const button = (label: string) => [...node.querySelectorAll<HTMLButtonElement>("button")]
  .find((element) => !element.closest('[inert], [aria-hidden="true"]') &&
    (element.getAttribute("aria-label") === label || element.textContent === label))!;
const mount = () => act(async () => root.render(createElement(MobileApp)));
async function picker() {
  await act(async () => button("Menu").click());
  await act(async () => { button("Switch device").click(); await vi.dynamicImportSettled(); });
}
async function switchTo(name: string) {
  await picker();
  await act(async () => button(`Switch to ${name}`).click());
}
const list = () => active('.mobile-home')!;

it.each([false, true])("keeps unseen replies ready for the drawer after leaving the assistant (native background: %s)", async (native) => {
  if (native) vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  let messages: AssistantMessage[] = [];
  const assistant: AssistantView = {
    id: "assistant-a", name: "My assistant", revision: 1, chatRevision: 0,
    lifecycle: "idle", enabled: true, harness: "codex", model: "codex:model",
    modelSettings: {}, runtimeMode: "full-access", targetRuntimeMode: "full-access",
    policy: fullAssistantPolicy(), policyVersion: 1,
    triggers: { user: true, event: true, schedule: true }, schedules: [], watches: [],
    maxAutoTurns: 8, chainWindowMinutes: 15, brainGeneration: 1,
  };
  fixture.request.mockImplementation((endpoint, input) => {
    if (input.method === "environment.describe")
      return { ...respond(endpoint, input), capabilities: ["assistant.v1"] };
    if (input.method === "assistant.get") return assistant;
    if (input.method === "assistant.messages") {
      const entries = messages.filter((entry) => entry.revision > input.params.afterRevision);
      return { entries, hasMore: false, nextRevision: entries.at(-1)?.revision ?? input.params.afterRevision };
    }
    return respond(endpoint, input);
  });
  const badge = () => active(".mobile-drawer-assistant")?.querySelector(".mobile-drawer-assistant-badge");
  await mount();
  await act(async () => button("Menu").click());
  await act(async () => { button("My assistant").click(); await vi.dynamicImportSettled(); });
  messages = [{ id: "seen", kind: "assistant", revision: 1, createdAt: 1, text: "Seen reply" }];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(localStorage.getItem("monocode.assistant-read:a")).toBe("1");
  if (native) {
    // Android can report appStateChange before the WebView's visibility changes.
    const appState = fixture.appListener.mock.calls.find(([event]) => event === "appStateChange")![1];
    expect(document.visibilityState).toBe("visible");
    act(() => appState({ isActive: false }));
    messages.push({ id: "background", kind: "assistant", revision: 2, createdAt: 2, text: "Background reply" });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(localStorage.getItem("monocode.assistant-read:a")).toBe("1");
    await act(async () => appState({ isActive: true }));
    expect(localStorage.getItem("monocode.assistant-read:a")).toBe("2");
  }
  await act(async () => button("Back").click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  messages.push({ id: "unseen", kind: "assistant", revision: 3, createdAt: 3, text: "New reply" });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  act(() => button("Menu").click());
  expect(badge()?.textContent).toBe("1");
  messages.push({ id: "while-open", kind: "assistant", revision: 4, createdAt: 4, text: "Another reply" });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(badge()?.textContent).toBe("2");
  expect(localStorage.getItem("monocode.assistant-read:a")).toBe(native ? "2" : "1");
});

it("moves the device selector above navigation, uses dots, and probes without changing the active device", async () => {
  await mount();
  expect(node.querySelector(".mobile-home-hosts")).toBeNull();
  await act(async () => button("Menu").click());
  const selector = button("Switch device");
  expect(node.querySelector(".mobile-drawer-top")!.firstElementChild).toBe(selector);
  expect(selector.textContent).toBe("Device A");
  expect(selector.querySelector('[role="status"]')!.getAttribute("aria-label")).toBe("Connected");
  expect(selector.querySelector(".mobile-host-status-label")).toBeNull();
  expect(node.querySelector(".mobile-drawer-settings")!.textContent).toBe("Settings");
  await act(async () => selector.click());
  await act(async () => vi.dynamicImportSettled());
  expect(node.querySelector('.mobile-drawer-backdrop')!.getAttribute("data-open")).toBe("true");
  expect(node.querySelector('.mobile-drawer')!.hasAttribute("inert")).toBe(true);
  expect(active('[role="dialog"]')!.closest('.mobile-sheet-backdrop')!.getAttribute("data-placement")).toBe("anchor");
  expect(button("Switch to Device B").querySelector('[data-state="connected"]')).not.toBeNull();
  expect(fixture.client!.connection?.environmentId).toBe("a");
  expect(fixture.client!.cachedSessions(project.id)?.[0].title).toBe("Device A conversation");
});

it("clears the previous device while verification is pending, then replaces lists even with identical IDs", async () => {
  await mount();
  await picker();
  const verifying = deferred<unknown>();
  fixture.request.mockImplementation((endpoint, input) => endpoint === b.endpoint && input.method === "environment.describe"
    ? verifying.promise : respond(endpoint, input));
  await act(async () => button("Switch to Device B").click());
  expect(fixture.client!.connection?.environmentId).toBe("b");
  expect(node.querySelectorAll('[data-session-id="shared-session"]')).toHaveLength(0);
  expect(list().textContent).toContain("Connecting…");
  expect(document.querySelector('.status-toast[data-tone="loading"]')).toBeNull();
  expect(list().querySelector(".mobile-list-skeleton")).toBeNull();
  expect(list().textContent).not.toContain("No conversations yet");
  await act(async () => verifying.resolve(respond(b.endpoint, { method: "environment.describe" })));
  expect(list().textContent).toContain("Device B conversation");
  expect(list().textContent).not.toContain("Device A conversation");
  await act(async () => button("Menu").click());
  expect(active(".mobile-drawer")!.textContent).toContain("Device B conversation");
  expect(active(".mobile-drawer")!.textContent).not.toContain("Device A conversation");
});

it("keeps the failed device selected and the picker usable, then refreshes automatically after recovery", async () => {
  await mount();
  let offline = true;
  fixture.request.mockImplementation((endpoint, input) => {
    if (endpoint === b.endpoint && offline) throw new Error("Device B offline");
    return respond(endpoint, input);
  });
  await switchTo("Device B");
  expect(list().textContent).toContain("Couldn’t connect");
  expect(list().textContent).not.toContain("No conversations yet");
  expect(node.textContent).not.toContain("Device A conversation");
  await picker();
  expect(button("Switch to Device B").getAttribute("aria-pressed")).toBe("true");
  expect(button("Switch to Device B").querySelector('[data-state="failed"]')).not.toBeNull();
  expect(button("Switch to Device A").disabled).toBe(false);
  await act(async () => active('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => button("Sessions").click());
  offline = false;
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(fixture.client!.connection?.environmentId).toBe("b");
  expect(list().textContent).toContain("Device B conversation");
  expect(node.textContent).not.toContain("Device B offline");
});

it("reloads projects on manual reconnect after the selected device's project request fails", async () => {
  await mount();
  let failProjects = true;
  fixture.request.mockImplementation((endpoint, input) => {
    if (endpoint === b.endpoint && input.method === "projects.list" && failProjects) throw new Error("Projects unavailable");
    return respond(endpoint, input);
  });
  await switchTo("Device B");
  expect(list().textContent).toContain("Couldn’t connect");
  failProjects = false;
  const verifying = deferred<unknown>();
  fixture.request.mockImplementation((endpoint, input) => endpoint === b.endpoint && input.method === "environment.describe"
    ? verifying.promise : respond(endpoint, input));
  await act(async () => button("Retry").click());
  expect(button("Retry").disabled).toBe(true);
  expect(document.querySelector('.status-toast[data-tone="loading"]')).toBeNull();
  await act(async () => verifying.resolve(respond(b.endpoint, { method: "environment.describe" })));
  expect(list().textContent).toContain("Device B conversation");
});

it("ignores the previous device's delayed list and keeps the new device after another refresh", async () => {
  await mount();
  const stale = deferred<unknown>();
  fixture.request.mockImplementation((endpoint, input) => endpoint === a.endpoint && input.method === "sessions.list"
    ? stale.promise : respond(endpoint, input));
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  await switchTo("Device B");
  await act(async () => stale.resolve([{ ...summary("Stale A"), revision: 99 }]));
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(list().textContent).toContain("Device B conversation");
  expect(node.textContent).not.toContain("Stale A");
  expect(fixture.client!.cachedSessions(project.id)?.[0].title).toBe("Device B conversation");
});

it("restores a draft only in its original device and conversation", async () => {
  await mount();
  await act(async () => active('[data-session-id="shared-session"]')!.click());
  const field = active("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Draft for A");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await switchTo("Device B");
  await act(async () => active('[data-session-id="shared-session"]')!.click());
  expect((active("textarea") as HTMLTextAreaElement).value).toBe("");
  await switchTo("Device A");
  await act(async () => active('[data-session-id="shared-session"]')!.click());
  expect((active("textarea") as HTMLTextAreaElement).value).toBe("Draft for A");
});

it("opens the selected device's error state on an offline launch and can switch to a healthy device", async () => {
  fixture.request.mockImplementation((endpoint, input) => {
    if (endpoint === a.endpoint) throw new Error("Device A offline");
    return respond(endpoint, input);
  });
  localStorage.setItem("monocode.mobile.lastOnline:http://a", String(new Date(2026, 8, 15, 12).getTime()));
  await mount();
  expect(list().textContent).toContain("Couldn’t connect");
  expect(list().textContent).toContain("Last online: September 15, 2026");
  // The device row stays, and the page has no skeleton or duplicate error banner.
  expect([...active(".mobile-device-chips")!.querySelectorAll("button")].map((chip) => chip.textContent))
    .toEqual(["All", "Device A", "Device B"]);
  expect(list().querySelector(".mobile-list-skeleton")).toBeNull();
  expect(active(".mobile-error")).toBeUndefined();
  expect(button("Retry")).toBeDefined();
  await switchTo("Device B");
  expect(list().textContent).toContain("Device B conversation");
});

it("keeps refreshing the original device when an unresolved command prevents switching", async () => {
  // Left by an earlier run: only the client writes the journal while it runs.
  fixture.values.set("pending", JSON.stringify({
    endpoint: a.endpoint, environmentId: a.environmentId,
    command: { type: "send", commandId: "pending", sessionId: "shared-session", text: "Hello" },
  }));
  await mount();
  await switchTo("Device B");
  expect(fixture.client!.connection?.environmentId).toBe("a");
  fixture.request.mockImplementation((endpoint, input) => input.method === "sessions.list"
    ? [{ ...summary("Updated A"), revision: 2 }] : respond(endpoint, input));
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(list().textContent).toContain("Updated A conversation");
});

it("lists every device from Home's device row and opens another device's conversation there", async () => {
  await mount();
  const chips = () => [...active(".mobile-device-chips")!.querySelectorAll<HTMLButtonElement>("button")];
  expect(chips().map((chip) => chip.textContent)).toEqual(["All", "Device A", "Device B"]);
  expect(chips()[1].getAttribute("aria-checked")).toBe("true");
  expect(list().textContent).not.toContain("Device B conversation");
  await act(async () => chips()[0].click());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(localStorage.getItem("monocode.mobile.homeScope")).toBe("all");
  expect(fixture.client!.connection?.environmentId).toBe("a");
  const remote = [...list().querySelectorAll<HTMLButtonElement>('[data-session-id="shared-session"]')]
    .find((row) => row.textContent?.includes("Device B conversation"))!;
  expect(remote.querySelector(".mobile-home-session-host")!.textContent).toBe("Device B");
  // The other device's rows never enter the active device's caches.
  expect(fixture.client!.cachedSessions(project.id)?.map((item) => item.title)).toEqual(["Device A conversation"]);
  await act(async () => remote.click());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(fixture.client!.connection?.environmentId).toBe("b");
  expect(active(".mobile-header")!.textContent).toContain("Device B project");
  expect(node.textContent).toContain("Update Host to share settings.");
  expect(fixture.request).toHaveBeenCalledWith(b.endpoint, expect.objectContaining({
    method: "sessions.sync", params: expect.objectContaining({ sessionId: "shared-session" }),
  }));
});

it("keeps conversation navigation usable when workspace sync fails and reconnects without restoring over it", async () => {
  let workspaceAvailable = false;
  fixture.request.mockImplementation((endpoint, input) => {
    if (input.method === "environment.describe") return { ...respond(endpoint, input),
      capabilities: ["clientState.v1", "workspaces.read", "connections.list"] };
    if (input.method === "preferences.read") return { revision: 0, imported: true, values: {} };
    if (input.method === "connections.list") return { revision: 0, connections: [] };
    if (input.method === "sessions.sync") return { kind: "snapshot", value: respond(endpoint, { method: "sessions.get" }), serverTime: Date.now() };
    if (input.method === "workspaces.read") {
      if (endpoint === a.endpoint) return null;
      if (!workspaceAvailable) throw new Error("Workspace service unavailable");
      return { revision: 1, kind: "desktop", windowId: "desktop", updatedAt: 1,
        snapshot: { location: { environmentId: "b", projectId: project.id, sessionId: "other-session" } } };
    }
    if (input.method === "workspaces.save") return { ...input.params, revision: 2, updatedAt: 2 };
    return respond(endpoint, input);
  });
  await mount();
  await switchTo("Device B");
  await act(async () => active('[data-session-id="shared-session"]')!.click());
  expect(active(".mobile-header")!.textContent).toContain("Device B project");
  expect(active(".mobile-error")!.textContent).toContain("Workspace service unavailable");

  workspaceAvailable = true;
  fixture.request.mockClear();
  await act(async () => button("Reconnect").click());
  expect(fixture.request).toHaveBeenCalledWith(b.endpoint, expect.objectContaining({ method: "workspaces.read" }));
  expect(fixture.request).not.toHaveBeenCalledWith(b.endpoint, expect.objectContaining({
    method: "sessions.sync", params: expect.objectContaining({ sessionId: "other-session" }),
  }));
  expect(active(".mobile-header")!.textContent).toContain("Device B project");
  expect(active("textarea")).toBeDefined();
  expect(active(".mobile-error")).toBeUndefined();
});
