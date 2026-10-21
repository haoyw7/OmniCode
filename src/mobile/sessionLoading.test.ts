import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSession, HostSessionSummary, HostModelCatalog } from "../features/connections/model/protocol";
import { MobileApp } from "./MobileApp";
import { queryClient } from "../shared/lib/queryClient";
// These tests cover navigation, not chunk loading. Keep cold page compilation
// outside the interaction timeout and its pending React act scope.
import "./MobileBots";
import { setUiLanguage } from "../shared/i18n/language";
import { NATIVE_SESSION_PROVIDERS, type NativeSessionAccess, type NativeSessionProvider } from "../integrations/harness/core/nativeSessions";
import * as attachmentFiles from "./attachments";
import type { Attachment } from "../features/sessions/model/session";
import { fullBotPolicy } from "../features/bots/model/botView";

const host = vi.hoisted(() => ({
  connection: { endpoint: "http://computer:3774", environmentId: "host", name: "Computer" },
  status: { state: "connected" as const },
  capabilities: new Set<string>(),
  restore: vi.fn(async () => true),
  verify: vi.fn(async () => {}),
  pending: vi.fn(async () => undefined),
  savedConnections: vi.fn(async () => []),
  switchTo: vi.fn(async () => undefined),
  projects: vi.fn(async () => [{ id: "project", cwd: "/project", name: "Project" }]),
  sessions: vi.fn(), models: vi.fn(), session: vi.fn(), nativeAccess: vi.fn(), dispatch: vi.fn(),
  cache: new Map<string, HostSession>(),
  summaries: new Map<string, HostSessionSummary[]>(),
  activity: vi.fn(), commits: vi.fn(), updateSession: vi.fn(), markUnread: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("./client", () => ({
  MobileClient: class {
    hasCapability = (capability: string) => host.capabilities.has(capability);
    connection = host.connection;
    getConnectionStatus = () => host.status;
    subscribeConnectionStatus = () => () => {};
    restore = host.restore;
    verify = host.verify;
    pending = host.pending;
    savedConnections = host.savedConnections;
    switchTo = host.switchTo;
    projects = host.projects;
    sessions = host.sessions;
    updateSession = host.updateSession;
    models = host.models;
    rpc = host.rpc;
    session = host.session;
    nativeAccess = host.nativeAccess;
    dispatch = host.dispatch;
    uploadAttachments = async () => [];
    cachedModels = () => undefined;
    cachedSession = (id: string) => host.cache.get(id);
    cachedSessions = (id: string) => host.summaries.get(id);
    sessionPreviews = async () => undefined;
  },
}));
vi.mock("./useMobileActivity", () => ({
  useMobileActivity: (_client: unknown, options: unknown) => {
    host.activity(options);
    return { unreadIds: new Set(), markUnread: host.markUnread, permission: "unsupported", enabled: false };
  },
}));
vi.mock("./MobileAppUpdates", async () => {
  const { useLayoutEffect } = await import("react");
  return { useMobileAppUpdates: () => { useLayoutEffect(() => { host.commits(); }); return {}; } };
});
vi.mock("./MobileTranscript", () => ({
  MobileTranscript: ({ snapshot, disabled }: { snapshot: HostSession; disabled: boolean }) =>
    createElement("button", { "data-transcript": true, disabled }, snapshot.session.blocks[0]?.text),
}));
vi.mock("./MobileComposer", () => ({
  MobileComposer: ({ disabled, catalogLoading, configuration, value, onChange, onSend, canSend, canStop, onStop, onFiles, readingAttachments }: {
    catalogLoading?: boolean;
    disabled: boolean; configuration: { model: string }; value: string; onChange: (value: string) => void;
    onSend: () => void; canSend: boolean; canStop: boolean; onStop: () => void;
    onFiles: (files: File[]) => void; readingAttachments?: boolean;
  }) => createElement("div", {},
    createElement("textarea", { disabled, "data-model": configuration.model, "data-catalog-loading": catalogLoading, value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
    createElement("button", { "data-send": true, disabled: !canSend, onClick: onSend }, "Send"),
    createElement("button", { "data-attach": true, disabled: disabled || readingAttachments,
      onClick: () => onFiles([new File(["image"], "photo.png", { type: "image/png" })]) }, "Attach"),
    createElement("button", { "data-stop": true, disabled: !canStop, onClick: onStop }, "Stop")),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function snapshot(id = "one", revision = 1): HostSession {
  return {
    projectId: "project", revision, updatedAt: revision, status: "idle",
    session: { id, cwd: "/project", title: id, harness: "codex", model: "codex:existing",
      modelSettings: {}, runtimeMode: "supervised",
      blocks: [{ id: "reply", role: "assistant", text: `${id} revision ${revision}` }] },
  };
}
function nativeSnapshot(provider: NativeSessionProvider = "pi", id = "one"): HostSession {
  const value = snapshot(id);
  value.session.harness = provider;
  value.session.model = `${provider}:existing`;
  value.session.providerSessionId = `native-${id}`;
  value.session.nativeSession = { provider, providerSessionId: `native-${id}`, path: `/native/${id}.jsonl`,
    revision: "1", createdAt: 1, updatedAt: 1, blockIds: ["reply"] };
  return value;
}
const access = (state: NativeSessionAccess["state"] = "idle", path = "/native/one.jsonl"): NativeSessionAccess => ({
  state, path, reason: state === "idle" ? "available" : "externalProcess", checkedAt: 1,
});
const catalog: HostModelCatalog = { models: { codex: [
  { id: "codex:catalog-default", harness: "codex", name: "Default" },
] }, errors: {} };
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  queryClient.clear();
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host.cache.clear();
  host.summaries.clear();
  host.capabilities.clear();
  host.projects.mockReset().mockResolvedValue([{ id: "project", cwd: "/project", name: "Project" }]);
  host.updateSession.mockReset();
  host.markUnread.mockClear();
  host.activity.mockClear();
  host.models.mockReset().mockResolvedValue(catalog);
  host.rpc.mockReset().mockResolvedValue(null);
  host.session.mockReset().mockImplementation(async (id: string) => snapshot(id));
  host.nativeAccess.mockReset().mockResolvedValue(access());
  host.dispatch.mockReset().mockResolvedValue({ commandId: "sent", sessionId: "one", revision: 1 });
  host.sessions.mockReset().mockResolvedValue(["one", "two"].map((id) => ({
    id, projectId: "project", title: id, harness: "codex", revision: 1, updatedAt: 1, status: "idle",
  })));
  localStorage.clear();
  localStorage.setItem("omnicode-mobile-last", JSON.stringify({
    environmentId: "host", projectId: "project", sessionId: "one",
  }));
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  stopMotionClock();
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// Departing pages remain in DOM briefly but cannot be selected by the user.
const activePage = () => node.querySelector<HTMLElement>('[data-page-active="true"]')!;
const mount = () => act(async () => root.render(createElement(MobileApp)));
const transcript = () => activePage().querySelector<HTMLButtonElement>("[data-transcript]");
const composer = () => activePage().querySelector<HTMLTextAreaElement>("textarea")!;
const conversationLoading = () => activePage().querySelector(".mobile-chat > .mobile-loading");
async function open(id: string) {
  const homeRow = activePage().querySelector<HTMLButtonElement>(`.mobile-home-session[data-session-id="${id}"]`);
  if (homeRow) {
    await act(async () => homeRow.click());
    return;
  }
  await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click());
  await act(async () => node.querySelector<HTMLButtonElement>(`[data-session-id="${id}"]`)!.click());
}

describe("mobile conversation loading UI", () => {
  it("updates streaming text and context without committing the shell, then reflects title and run changes", async () => {
    let current: HostSession = { ...snapshot(), status: "running", runId: "run", supportsQueue: true };
    host.session.mockImplementation(async () => current);
    await mount();
    await open("one");
    // Begin after navigation and its initial confirmation have settled.
    await advanceMotionTimers(500);
    host.commits.mockClear();
    for (let revision = 2; revision <= 4; revision++) {
      current = { ...current, revision, updatedAt: revision,
        session: { ...current.session, modelSettings: {}, context: { used: revision * 100, window: 1000 },
          blocks: [{ id: "reply", role: "assistant", text: `Streaming ${revision}`, streaming: true }] } };
      await advanceMotionTimers(250);
      expect(transcript()?.textContent).toBe(`Streaming ${revision}`);
    }
    expect(host.commits).not.toHaveBeenCalled();
    current = { ...current, revision: 5, status: "idle", runId: undefined,
      session: { ...current.session, title: "Finished conversation" } };
    await advanceMotionTimers(250);
    expect(node.querySelector("header")?.textContent).toContain("Finished conversation");
    expect(activePage().querySelector<HTMLButtonElement>("[data-stop]")?.disabled).toBe(true);
    const second = snapshot("two", 7);
    host.cache.set("two", second);
    host.session.mockImplementation(async (id: string) => id === "two" ? second : current);
    await open("two");
    expect(transcript()?.textContent).toBe("two revision 7");
    expect(node.querySelector('[data-page-active="false"] [data-transcript]')?.textContent).toBe("Streaming 4");
  });

  it("keeps the focused draft editable while attachments are read, but blocks sending and another picker", async () => {
    const reading = deferred<Attachment[]>();
    vi.spyOn(attachmentFiles, "readMobileAttachments").mockReturnValueOnce(reading.promise);
    await mount();
    await open("one");
    const field = composer();
    act(() => {
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep typing");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      activePage().querySelector<HTMLButtonElement>("[data-attach]")!.click();
    });
    expect(composer()).toBe(field);
    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(activePage().querySelector<HTMLButtonElement>("[data-send]")!.disabled).toBe(true);
    expect(activePage().querySelector<HTMLButtonElement>("[data-attach]")!.disabled).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Keep typing while reading");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => reading.resolve([{ id: "photo", name: "photo.png", mimeType: "image/png", kind: "image", data: "aGVsbG8=", size: 5 }]));
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Keep typing while reading");
    expect(activePage().querySelector<HTMLButtonElement>("[data-send]")!.disabled).toBe(false);
    expect(activePage().querySelector<HTMLButtonElement>("[data-attach]")!.disabled).toBe(false);
  });

  it("opens Bots as a normal page from a system notification without requesting a worker session", async () => {
    host.rpc.mockImplementation(async (method: string) => method === "environment.describe"
      ? { capabilities: ["bots.v1"] } : method === "bots.list" ? { bots: [], threads: [] } : null);
    await mount();
    host.session.mockClear();
    const options = host.activity.mock.calls.at(-1)![0];
    await act(async () => options.onOpen({ environmentId: "host", kind: "assistant" }));
    await act(async () => vi.dynamicImportSettled());
    expect(host.activity.mock.calls.at(-1)![0].assistantVisible).toBe(true);
    expect(activePage().querySelector(".mobile-bots")).not.toBeNull();
    expect(node.querySelector(".mobile-page-overlay, .mobile-assistant-overlay")).toBeNull();
    await advanceMotionTimers(500);
    expect(node.querySelector("[data-transcript]")).toBeNull();
    expect(host.session).not.toHaveBeenCalled();
  });
  it("navigates from a conversation through the Bots list and Bot chat, then returns without an underlying page", async () => {
    host.rpc.mockImplementation(async (method: string) => method === "environment.describe"
      ? { capabilities: ["bots.v1"] } : method === "bots.list"
        ? { bots: [{ id: "a", name: "Bot A", defaultThreadId: "a-thread" }], threads: [], defaultBotId: "a", defaultThreadId: "a-thread" }
        : null);
    await mount(); await open("one"); await advanceMotionTimers(500);
    await act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Menu"]')!.click());
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-assistant")!.click());
    await act(async () => vi.dynamicImportSettled());
    await advanceMotionTimers(500);
    expect(node.querySelector("[data-transcript]")).toBeNull();
    expect(node.querySelector(".mobile-page-overlay, .mobile-assistant-overlay")).toBeNull();
    expect(activePage().querySelector(".mobile-bots")).not.toBeNull();
    await act(async () => activePage().querySelector<HTMLButtonElement>('[data-ui="navigation-item"]')!.click());
    await advanceMotionTimers(500);
    expect(activePage().querySelector(".mobile-bot-chat-page")).not.toBeNull();
    expect(node.querySelector(".mobile-bots-list")).toBeNull();
    expect(node.querySelector("[data-transcript]")).toBeNull();
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-assistant-header [aria-label="Back"]')!.click());
    await advanceMotionTimers(500);
    expect(activePage().querySelector(".mobile-bots-list")).not.toBeNull();
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-bots header [aria-label="Back"]')!.click());
    await advanceMotionTimers(500);
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(node.querySelector(".mobile-bots, .mobile-bot-chat-page")).toBeNull();
  });
  it.each(["task", "worker", "archived"])("opens a %s card in its exact project and returns to the originating non-default Bot", async kind => {
    const owner = { id: "execution", cwd: "/execution", name: "Execution Project" };
    const projects = [{ id: "project", cwd: "/project", name: "Project" }, owner];
    host.projects.mockResolvedValue(projects);
    host.sessions.mockImplementation(async projectId => projectId === owner.id
      ? [{ id: "task", projectId: owner.id, title: "Source task", harness: "codex", revision: 1, updatedAt: 1, status: "idle" }]
      : ["one", "two"].map(id => ({ id, projectId: "project", title: id, harness: "codex", revision: 1, updatedAt: 1, status: "idle" })));
    const target = { ...snapshot("task"), projectId: owner.id, archived: kind === "archived",
      session: { ...snapshot("task").session, cwd: owner.cwd, executionCwd: "/worktrees/task",
        ...(kind === "worker" ? { orchestrationLeadId: "lead" } : {}) } };
    host.session.mockImplementation(async id => id === "task" ? target : snapshot(id));
    const config = { id: "b", name: "Bot B", enabled: true, revision: 1, chatRevision: 1, lifecycle: "idle",
      harness: "claude", model: "claude-model", modelSettings: {}, policy: fullBotPolicy(), policyVersion: 1,
      triggers: { user: true, event: true, schedule: true }, watches: [], schedules: [], brainGeneration: 1 };
    host.rpc.mockImplementation(async (method: string) => {
      if (method === "environment.describe") return { capabilities: ["bots.v1", "assistant.v1"] };
      if (method === "bots.list") return { bots: [{ ...config, defaultThreadId: "b-thread" }], threads: [], defaultBotId: "a", defaultThreadId: "a-thread" };
      if (method === "botThreads.get") return config;
      if (method === "botThreads.messages") return { entries: [{ id: "old-card", revision: 1, createdAt: 1, kind: "session-card",
        ref: { environmentId: "host", projectId: owner.id, sessionId: "task" }, projectName: owner.name,
        title: "Codex · Source task", harness: "codex", model: "existing", actionId: "old-action", status: "running" }], nextRevision: 1, hasMore: false };
      if (method === "projects.list") return projects;
      if (method === "models.list") return catalog;
      if (method === "sessions.get") return target;
      return null;
    });
    await mount(); await open("one"); await advanceMotionTimers(500);
    await act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Menu"]')!.click());
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-assistant")!.click());
    await act(async () => vi.dynamicImportSettled()); await advanceMotionTimers(500);
    await act(async () => activePage().querySelector<HTMLButtonElement>('[data-ui="navigation-item"]')!.click());
    await advanceMotionTimers(500);
    const card = activePage().querySelector(".assistant-card")!;
    const openCard = card.querySelector<HTMLButtonElement>('button[aria-label="Open session"]')!;
    expect(openCard.title).toContain("Execution Project");
    expect(card.querySelector('[role="img"][aria-label="Codex"]')).not.toBeNull();
    expect(openCard.title).toContain("existing");
    expect(card.textContent).toContain("Source task");
    expect(openCard.title).toContain("Session: task");
    expect(card.textContent).toContain("Running");
    expect(card.textContent).not.toContain("Claude");
    await act(async () => card.querySelector<HTMLButtonElement>("button")!.click());
    await advanceMotionTimers(500);
    expect(host.rpc).toHaveBeenCalledWith("sessions.get", { sessionId: "task" });
    expect(transcript()?.textContent).toBe("task revision 1");
    expect(node.querySelector("header")?.textContent).toContain(owner.name);
    expect(host.models).toHaveBeenCalledWith(owner.id, false, expect.any(Function));
    expect(composer().disabled).toBe(kind !== "task");
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Back to Bot conversation"]')!.click());
    await advanceMotionTimers(500);
    expect(activePage().querySelector(".mobile-assistant-header")?.textContent).toContain("Bot B");
    expect(activePage().querySelector(".assistant-card")?.textContent).toContain("Source task");
    expect(node.querySelector("[data-transcript]")).toBeNull();
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-assistant-header [aria-label="Back"]')!.click());
    await advanceMotionTimers(500);
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-bots header [aria-label="Back"]')!.click());
    await advanceMotionTimers(500);
    expect(transcript()?.textContent).toBe("one revision 1");
  });
  it("shares fresh lists across Home and the drawer without extra requests on either handoff", async () => {
    await mount();
    host.sessions.mockClear();
    await act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Menu"]')!.click());
    expect(host.sessions).not.toHaveBeenCalled();
    host.sessions.mockClear();
    await advanceMotionTimers(3_000);
    expect(host.sessions).toHaveBeenCalledTimes(1);
    host.sessions.mockClear();
    await act(async () => node.querySelector<HTMLDivElement>(".mobile-drawer-backdrop")!.click());
    expect(host.sessions).not.toHaveBeenCalled();
  });

  it("keeps keystrokes inside the composer and sends the latest draft without rendering the shell", async () => {
    await mount();
    await open("one");
    const type = (value: string) => act(() => {
      const field = composer();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = () => activePage().querySelector<HTMLButtonElement>("[data-send]")!;
    host.activity.mockClear();
    type("  ");
    expect(send().disabled).toBe(true);
    for (const value of ["n", "ni", "你", "你好", "你好，检查代码"]) type(value);
    expect(composer().value).toBe("你好，检查代码");
    expect(send().disabled).toBe(false);
    expect(host.activity).not.toHaveBeenCalled();
    await act(async () => send().click());
    expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "send", sessionId: "one", text: "你好，检查代码",
    }), undefined);
    expect(composer().value).toBe("");
    expect(send().disabled).toBe(true);
    type("Unsent draft");
    await open("two");
    expect(composer().value).toBe("");
  });

  it("retains the locally edited draft when sending fails", async () => {
    await mount();
    await open("one");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer(), "Keep this draft");
      composer().dispatchEvent(new Event("input", { bubbles: true }));
    });
    host.dispatch.mockRejectedValueOnce(new Error("Host offline"));
    await act(async () => activePage().querySelector<HTMLButtonElement>("[data-send]")!.click());
    expect(composer().value).toBe("Keep this draft");
    expect(activePage().querySelector<HTMLButtonElement>("[data-send]")!.disabled).toBe(false);
  });

  const projectChat = async () => {
    await mount();
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click());
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-more-toggle")!.click());
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-all-projects")!.click());
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-home-project[title="/project"]')!.click());
    await open("one");
  };
  const goBack = () => act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Back"]')!.click());

  it("opens Home, the project menu and the drawer in cached activity order while network histories are pending", async () => {
    host.projects.mockResolvedValue([
      { id: "project", cwd: "/project", name: "Project" },
      { id: "newer", cwd: "/newer", name: "Newer project" },
    ]);
    const summary = (projectId: string, updatedAt: number): HostSessionSummary => ({
      id: projectId, projectId, updatedAt, title: projectId, harness: "codex", status: "idle", revision: 1,
    });
    host.summaries.set("project", [summary("project", 1)]);
    host.summaries.set("newer", [summary("newer", 100)]);
    host.sessions.mockReturnValue(new Promise(() => {}));
    await mount();
    expect([...activePage().querySelectorAll('.mobile-home-recent [data-session-id]')].map((row) => row.getAttribute("data-session-id")))
      .toEqual(["newer", "project"]);
    expect(activePage().querySelector('.mobile-home .mobile-loading')).toBeNull();
    const projectMenu = node.querySelector<HTMLButtonElement>('header [aria-label="Projects"]')!;
    await act(async () => projectMenu.click());
    expect([...node.querySelectorAll('.mobile-project-options strong')].map((row) => row.textContent))
      .toEqual(["Newer project", "Project"]);
    await act(async () => projectMenu.click());
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click());
    expect([...node.querySelectorAll('.mobile-drawer [data-session-id]')].map((row) => row.getAttribute("data-session-id")))
      .toEqual(["newer", "project"]);
  });

  it("returns during project conversation loading and ignores the late response", async () => {
    const response = deferred<HostSession>();
    host.session.mockReturnValue(response.promise);
    await projectChat();
    expect(conversationLoading()).not.toBeNull();
    expect(node.querySelector('header [aria-label="Menu"]')).toBeNull();
    await goBack();
    expect(node.querySelector("header strong")!.textContent).toBe("Project");
    await act(async () => response.resolve(snapshot()));
    expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("home");
    expect(node.querySelector("header strong")!.textContent).toBe("Project");
    expect(transcript()).toBeNull();
  });

  it.each([false, true])("returns after a project conversation load failure (cached: %s)", async (cached) => {
    if (cached) host.cache.set("one", snapshot());
    host.session.mockRejectedValue(new Error("Offline"));
    await projectChat();
    expect(node.textContent).toContain("Offline");
    expect(node.querySelector('header [aria-label="Menu"]')).toBeNull();
    await goBack();
    expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("home");
    expect(node.querySelector("header strong")!.textContent).toBe("Project");
  });

  it("preserves project Back when an unavailable conversation falls back to a draft", async () => {
    host.session.mockResolvedValue({ ...snapshot(), archived: true });
    await projectChat();
    expect(node.querySelector("header strong")!.textContent).toBe("New conversation");
    await goBack();
    expect(node.querySelector("header strong")!.textContent).toBe("Project");
  });

  it("keeps the Bots navigation label when the default assistant identity changes or fails to load", async () => {
    const identity = deferred<{ name: string }>();
    host.capabilities.add("assistant.v1");
    const getAssistant = vi.fn().mockReturnValue(identity.promise);
    host.rpc.mockImplementation(async (method: string) => method === "assistant.get"
      ? getAssistant()
      : { entries: [], nextRevision: 0, hasMore: false });
    await mount();
    const openDrawer = async () => {
      await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Menu"]')!.click());
    };
    const assistant = () => node.querySelector(".mobile-drawer-assistant")!;
    const closeDrawer = async () => {
      await act(async () => [...node.querySelectorAll<HTMLButtonElement>(".mobile-drawer-top > button")]
        .find((button) => button.textContent === "Sessions")!.click());
    };
    await openDrawer();
    expect(assistant().textContent).toBe("Bots");
    await act(async () => identity.resolve({ name: "小管家" }));
    expect(assistant().textContent).toBe("Bots");
    await closeDrawer();
    getAssistant.mockResolvedValue({ name: "我的助理" });
    await openDrawer();
    await advanceMotionTimers(2000);
    expect(assistant().textContent).toBe("Bots");
    await closeDrawer();
    getAssistant.mockRejectedValue(new Error("Offline"));
    await openDrawer();
    await advanceMotionTimers(2000);
    expect(assistant().textContent).toBe("Bots");
  });

  it("warms models on Home without waiting for discovery or opening a conversation", async () => {
    const models = deferred<HostModelCatalog>();
    host.models.mockReturnValue(models.promise);
    await mount();
    expect(host.models).toHaveBeenCalledWith("project");
    expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("home");
    expect(node.querySelector('[data-session-id="one"]')).not.toBeNull();
    expect(host.session).not.toHaveBeenCalled();
    // This mock is an older Host, so only its upgrade notice may show.
    expect([...node.querySelectorAll('[role="alert"]')]
      .map((alert) => alert.textContent ?? "")
      .filter((text) => !text.startsWith("Update Host to share"))).toEqual([]);
    await act(async () => models.resolve(catalog));
  });

  it("edits a home conversation in its own project and animates menu dismissal", async () => {
    localStorage.removeItem("omnicode-mobile-last");
    host.projects.mockResolvedValue([
      { id: "project", name: "Project", cwd: "/project" },
      { id: "other", name: "Other", cwd: "/other" },
    ]);
    let other: HostSessionSummary = { id: "other-chat", projectId: "other", title: "Other conversation", harness: "codex", status: "idle", revision: 3, updatedAt: 3 };
    host.sessions.mockImplementation(async (id: string) => id === "other" ? [other] : []);
    host.updateSession.mockImplementation(async (_project: string, _id: string, patch: object) => {
      other = { ...other, ...patch, revision: other.revision + 1 };
      return other;
    });
    await mount();
    const showMenu = async () => {
      const row = node.querySelector<HTMLButtonElement>('[data-session-id="other-chat"]')!;
      await act(async () => {
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 90, clientY: 220 }));
        await vi.dynamicImportSettled();
      });
      await advanceMotionTimers(300);
    };
    const action = (name: string) => [...node.querySelectorAll<HTMLButtonElement>('.mobile-session-actions button')].find((button) => button.textContent === name)!;
    await showMenu();
    expect(node.querySelector('.mobile-session-menu-title')?.textContent).toBe("Other conversation");
    expect(node.querySelector('.mobile-app')?.getAttribute('data-view')).toBe('home');
    await act(async () => action("Pin").click());
    expect(host.updateSession).toHaveBeenCalledWith("other", "other-chat", { pinned: true });
    expect(activePage().querySelector('[data-session-id="other-chat"] .mobile-home-session-pin')).not.toBeNull();
    expect(node.querySelector('.mobile-sheet-backdrop[data-fold-state="closing"]')?.hasAttribute('inert')).toBe(true);
    await advanceMotionTimers(300);
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    await showMenu();
    expect(action("Unpin")).toBeDefined();
    await act(async () => action("Mark as unread").click());
    expect(host.markUnread).toHaveBeenCalledWith("other-chat", 4);
    await advanceMotionTimers(300);
    await showMenu();
    host.updateSession.mockRejectedValueOnce(new Error("Host offline"));
    await act(async () => action("Archive").click());
    expect(node.querySelector('.mobile-session-actions [role="alert"]')?.textContent).toBe("Host offline");
    expect(node.querySelector('[data-session-id="other-chat"]')).not.toBeNull();
    await act(async () => action("Archive").click());
    expect(host.updateSession).toHaveBeenLastCalledWith("other", "other-chat", { archived: true });
    await advanceMotionTimers(400);
    expect(node.querySelector('[data-session-id="other-chat"]')).toBeNull();
  });

  it("shows a new conversation immediately while its drawer history loads", async () => {
    localStorage.removeItem("omnicode-mobile-last");
    const history = deferred<HostSessionSummary[]>();
    host.sessions.mockReturnValue(history.promise);
    await mount();
    expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("home");
    expect(activePage().querySelector(".mobile-home-recent")?.textContent).toContain("Loading conversations…");
    await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
    expect(conversationLoading()).toBeNull();
    expect(node.querySelector(".mobile-header-title strong")?.textContent).toBe("New conversation");
    expect(composer().disabled).toBe(false);
    await act(async () => history.resolve([]));
  });

  it("keeps the draft page through creation and follow-up sends, but animates a fresh draft in the same project", async () => {
    await mount();
    await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
    const page = activePage();
    const input = composer();
    const sendDraft = async (text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => activePage().querySelector<HTMLButtonElement>("[data-send]")!.click());
    };

    await sendDraft("First request");
    expect(host.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "create", projectId: "project",
    }), { text: "First request" });
    expect(activePage()).toBe(page);
    expect(composer()).toBe(input);
    expect(transcript()?.textContent).toBe("one revision 1");

    await sendDraft("Follow up");
    expect(host.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "send", sessionId: "one", text: "Follow up",
    }), undefined);
    expect(activePage()).toBe(page);
    expect(composer()).toBe(input);

    await act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Menu"]')!.click());
    await act(async () => node.querySelector<HTMLButtonElement>('.mobile-drawer-new')!.click());
    expect(activePage()).not.toBe(page);
    expect(composer()).not.toBe(input);
    expect(page.isConnected).toBe(true);
    expect(page.getAttribute("data-page-active")).toBe("false");
    expect(page.hasAttribute("inert")).toBe(true);
    expect(composer().value).toBe("");
    expect(transcript()).toBeNull();
    await advanceMotionTimers(240);
    expect(page.isConnected).toBe(false);
  });

  it("falls back from an archived snapshot before history settles and retains a default model", async () => {
    const history = deferred<HostSessionSummary[]>();
    const archived = { ...snapshot(), archived: true };
    host.cache.set("one", archived);
    host.session.mockResolvedValue(archived);
    host.sessions.mockReturnValue(history.promise);
    host.sessions.mockResolvedValueOnce([{ id: "one", projectId: "project", title: "one", harness: "codex", status: "idle", revision: 1, updatedAt: 1 }]);
    await mount();
    await open("one");
    expect(transcript()).toBeNull();
    expect(node.querySelector(".mobile-header-title strong")?.textContent).toBe("New conversation");
    expect(composer().getAttribute("data-model")).toBe("codex:catalog-default");
    await act(async () => history.resolve([]));
    expect(host.activity.mock.calls.at(-1)![0].visibleSession).toBeUndefined();
  });

  it("opens text without waiting for the drawer's Git-backed session list", async () => {
    const history = deferred<HostSessionSummary[]>();
    host.sessions.mockReturnValue(history.promise);
    host.sessions.mockResolvedValueOnce([{ id: "one", projectId: "project", title: "one", harness: "codex", status: "idle", revision: 1, updatedAt: 1 }]);
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(conversationLoading()).toBeNull();
    await act(async () => history.resolve([{ id: "one", projectId: "project", title: "one",
      harness: "codex", status: "idle", revision: 1, updatedAt: 1 }]));
  });

  it("opens text before model discovery settles and keeps the session's own model", async () => {
    const models = deferred<HostModelCatalog>();
    host.models.mockReturnValue(models.promise);
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(conversationLoading()).toBeNull();
    expect(composer().getAttribute("data-model")).toBe("codex:existing");
    expect(composer().getAttribute("data-catalog-loading")).toBe("true");
    await act(async () => models.resolve(catalog));
    expect(composer().getAttribute("data-model")).toBe("codex:existing");
    expect(composer().getAttribute("data-catalog-loading")).toBe("false");
  });

  it("unlocks the current Agent from a partial catalog while another Agent is still discovering", async () => {
    const models = deferred<HostModelCatalog>();
    const listeners: ((catalog: HostModelCatalog) => void)[] = [];
    host.models.mockImplementation((_project, _refresh, update) => {
      if (update) listeners.push(update);
      return models.promise;
    });
    await mount();
    await open("one");
    expect(composer().getAttribute("data-catalog-loading")).toBe("true");
    await act(async () => {
      for (const update of listeners) update({ ...catalog, pending: ["pi"] });
    });
    expect(composer().getAttribute("data-catalog-loading")).toBe("false");
    expect(composer().getAttribute("data-model")).toBe("codex:existing");
    await act(async () => models.resolve({ ...catalog, errors: { pi: "Unavailable" }, pending: [] }));
    expect(composer().getAttribute("data-model")).toBe("codex:existing");
  });

  it("keeps history and text available when model discovery fails", async () => {
    host.models.mockRejectedValue(new Error("Model discovery failed"));
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(conversationLoading()).toBeNull();
    expect(composer().getAttribute("data-catalog-loading")).toBe("false");
    await open("two");
    expect(transcript()?.textContent).toBe("two revision 1");
  });

  it("renders cached text immediately, with commands and unread confirmation gated on fresh sync", async () => {
    const refresh = deferred<HostSession>();
    host.cache.set("one", snapshot());
    host.session.mockReturnValue(refresh.promise);
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(conversationLoading()).toBeNull();
    expect(transcript()?.disabled).toBe(true);
    expect(composer().disabled).toBe(true);
    expect(host.activity.mock.calls.at(-1)![0].visibleSession).toBeUndefined();
    expect(node.querySelector("header .mobile-reload-status")?.textContent).toBe("Reloading…");
    await act(async () => refresh.resolve(snapshot("one", 2)));
    expect(node.querySelector("header .mobile-reload-status")).toBeNull();
    expect(transcript()?.textContent).toBe("one revision 2");
    expect(transcript()?.disabled).toBe(false);
    expect(composer().disabled).toBe(false);
    expect(host.activity.mock.calls.at(-1)![0].visibleSession.revision).toBe(2);
  });

  it("waits for the sync instead of flashing a cached transcript the list has outgrown", async () => {
    const refresh = deferred<HostSession>();
    host.cache.set("one", snapshot());
    host.summaries.set("project", [{
      id: "one", projectId: "project", title: "one", harness: "codex", revision: 5, updatedAt: 5, status: "running",
    }]);
    host.session.mockReturnValue(refresh.promise);
    await mount();
    await open("one");
    expect(transcript()).toBeNull();
    expect(conversationLoading()).not.toBeNull();
    await act(async () => refresh.resolve(snapshot("one", 5)));
    expect(transcript()?.textContent).toBe("one revision 5");
  });

  it("preserves cached text but keeps commands disabled after a failed refresh", async () => {
    host.cache.set("one", snapshot());
    host.session.mockRejectedValue(new Error("Failed to fetch"));
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(composer().disabled).toBe(true);
    expect(transcript()?.disabled).toBe(true);
    expect(host.activity.mock.calls.at(-1)![0].visibleSession).toBeUndefined();
    expect(node.querySelector("header .mobile-reload-status")?.textContent).toBe("Network error");
    expect(node.querySelector(".mobile-notices")?.textContent).not.toContain("Failed to fetch");
    host.session.mockResolvedValue(snapshot("one", 2));
    await advanceMotionTimers(4500);
    expect(node.querySelector("header .mobile-reload-status")).toBeNull();
    expect(transcript()?.textContent).toBe("one revision 2");
    expect(composer().disabled).toBe(false);
  });

  it("ignores an older navigation response after another cached conversation opens", async () => {
    const old = deferred<HostSession>();
    const fresh = deferred<HostSession>();
    host.cache.set("one", snapshot());
    host.cache.set("two", snapshot("two"));
    host.session.mockImplementation((id: string) => id === "one" ? old.promise : fresh.promise);
    await mount();
    await open("one");
    await open("two");
    expect(transcript()?.textContent).toBe("two revision 1");
    await act(async () => old.resolve(snapshot("one", 20)));
    expect(transcript()?.textContent).toBe("two revision 1");
    await act(async () => fresh.resolve(snapshot("two", 2)));
    expect(transcript()?.textContent).toBe("two revision 2");
  });
});

describe("mobile imported native continuation", () => {
  it.each(NATIVE_SESSION_PROVIDERS)("continues the existing %s conversation after ownership is confirmed", async (provider) => {
    const value = nativeSnapshot(provider);
    host.session.mockResolvedValue(value);
    await mount();
    await open("one");
    expect(composer().disabled).toBe(false);
    expect(node.querySelector(".mobile-native-readonly")).toBeNull();
    await act(async () => {
      const area = composer();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Continue here");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => node.querySelector<HTMLButtonElement>("[data-send]")!.click());
    expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "send", sessionId: "one", text: "Continue here",
    }), undefined);
    expect(value.session.providerSessionId).toBe("native-one");
  });

  it("keeps checking and externally owned history readable, then unlocks when the CLI exits", async () => {
    const check = deferred<NativeSessionAccess>();
    host.session.mockResolvedValue(nativeSnapshot());
    host.nativeAccess.mockReturnValueOnce(check.promise).mockResolvedValue(access());
    await mount();
    await open("one");
    expect(transcript()?.textContent).toBe("one revision 1");
    expect(composer().disabled).toBe(true);
    expect(node.querySelector(".mobile-native-readonly")?.textContent).toContain("Checking whether");
    await act(async () => check.resolve({ ...access("external"), holder: { pid: 42, command: "pi", provider: "pi" } }));
    expect(composer().disabled).toBe(true);
    expect(node.querySelector(".mobile-native-readonly")?.textContent).toContain("Pi (pid 42)");
    await advanceMotionTimers(5000);
    expect(composer().disabled).toBe(false);
  });

  it.each([
    [null, "Reconnect to the Host"],
    [{ ...access("unknown"), reason: "unsupportedPlatform" }, "ownership cannot be verified on this platform"],
    [{ ...access("unknown"), reason: "anotherOmniCode" }, "OmniCode desktop is using"],
    [{ ...access("unknown"), reason: "ambiguousProcess", holder: { pid: 43, provider: "pi", command: "pi" } }, "may be using this conversation"],
    [new Error("Timeout"), "Reconnect to the Host"],
    [access("idle", "/native/different.jsonl"), "Reconnect to the Host"],
  ])("blocks unavailable access with the correct recovery hint (%s)", async (result, hint) => {
    host.session.mockResolvedValue(nativeSnapshot());
    if (result instanceof Error) host.nativeAccess.mockRejectedValue(result);
    else host.nativeAccess.mockResolvedValue(result);
    await mount();
    await open("one");
    expect(composer().disabled).toBe(true);
    expect(node.querySelector(".mobile-native-readonly")?.textContent).toContain(hint);
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it("allows queueing and cancellation during a Host turn, but keeps a desktop busy mirror locked", async () => {
    const value = { ...nativeSnapshot(), status: "running" as const };
    host.session.mockResolvedValue(value);
    host.nativeAccess.mockResolvedValue(access("external"));
    await mount();
    await open("one");
    expect(composer().disabled).toBe(true);
    expect(node.querySelector(".mobile-native-readonly")).not.toBeNull();
    host.session.mockResolvedValue({ ...value, runId: "host-run", supportsQueue: true });
    await advanceMotionTimers(1000);
    expect(composer().disabled).toBe(false);
    expect(node.querySelector<HTMLButtonElement>("[data-stop]")!.disabled).toBe(false);
    expect(node.querySelector(".mobile-native-readonly")).toBeNull();
    await act(async () => node.querySelector<HTMLButtonElement>("[data-stop]")!.click());
    expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "cancel", sessionId: "one", runId: "host-run",
    }), undefined);
  });

  it("waits for a slow probe before scheduling another and discards it after navigation", async () => {
    const old = deferred<NativeSessionAccess>();
    host.session.mockImplementation(async (id: string) => nativeSnapshot("pi", id));
    host.nativeAccess.mockReturnValueOnce(old.promise).mockResolvedValue(access("external", "/native/two.jsonl"));
    await mount();
    await open("one");
    await advanceMotionTimers(15000);
    expect(host.nativeAccess).toHaveBeenCalledTimes(1);
    await open("two");
    await act(async () => old.resolve(access()));
    expect(composer().disabled).toBe(true);
    expect(transcript()?.textContent).toBe("two revision 1");
  });

  it("rechecks when an OpenCode binding changes in the same database", async () => {
    const first = nativeSnapshot("opencode");
    first.session.nativeSession!.storage = "sqlite";
    first.session.nativeSession!.path = "/native/opencode.db";
    host.session.mockResolvedValue(first);
    host.nativeAccess.mockResolvedValueOnce(access("idle", "/native/opencode.db"));
    await mount();
    await open("one");
    expect(composer().disabled).toBe(false);
    const check = deferred<NativeSessionAccess>();
    host.nativeAccess.mockReturnValue(check.promise);
    host.session.mockResolvedValue({ ...first, revision: 2, session: { ...first.session,
      nativeSession: { ...first.session.nativeSession!, providerSessionId: "native-rebound" } } });
    await advanceMotionTimers(3000);
    expect(composer().disabled).toBe(true);
    expect(host.nativeAccess).toHaveBeenCalledTimes(2);
    await act(async () => check.resolve(access("external", "/native/opencode.db")));
    expect(composer().disabled).toBe(true);
  });

  it("clears idle access in the background and checks again immediately on resume", async () => {
    host.session.mockResolvedValue(nativeSnapshot());
    await mount();
    await open("one");
    expect(composer().disabled).toBe(false);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await advanceMotionTimers(10000);
    expect(host.nativeAccess).toHaveBeenCalledTimes(1);
    const check = deferred<NativeSessionAccess>();
    host.nativeAccess.mockReturnValue(check.promise);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(composer().disabled).toBe(true);
    expect(host.nativeAccess).toHaveBeenCalledTimes(2);
    await act(async () => check.resolve(access("external")));
    expect(composer().disabled).toBe(true);
  });
});
