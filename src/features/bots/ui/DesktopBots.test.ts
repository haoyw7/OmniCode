// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBots } from "./DesktopBots";
import { fullBotPolicy, type BotMessage } from "../model/botView";
import { configureSharedHost, remoteProjectFor } from "../../connections/model/remoteProjects";
import { setSharedSessionBackend } from "../../sessions/data/sharedSessionBackend";
import { setUiLanguage } from "../../../shared/i18n/language";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  openFile: vi.fn(),
  refresh: vi.fn(),
  hosts: [{ id: "machine", environmentId: "host", name: "Host", endpoint: "" }],
}));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: (...args: unknown[]) => mocks.rpc(...args),
  refreshRemoteProjectSessions: () => mocks.refresh(),
  useRemoteMachines: () => ({ machines: mocks.hosts }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("./BotFilePanel", () => ({
  useBotFilePanel: () => ({ open: mocks.openFile }),
  BotFilePanel: () => null,
}));
vi.mock("./BotWorkerDetails", () => ({
  BotWorkerDetails: () => createElement("div", null, "Read-only worker"),
}));

const project = { id: "project", name: "Project", cwd: "/work/project" };
const card: Extract<BotMessage, { kind: "session-card" }> = {
  kind: "session-card", id: "card", revision: 1, createdAt: 1,
  ref: { environmentId: "host", projectId: "project", sessionId: "target" },
  title: "Play music", projectName: "Project", harness: "pi", model: "test",
  actionId: "action", status: "completed",
};
let root: Root, node: HTMLDivElement;
let view: { policy: ReturnType<typeof fullBotPolicy> };
let getSession: () => Promise<unknown>;
const local = vi.fn(), remote = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  local.mockReset();
  remote.mockReset();
  localStorage.clear();
  setUiLanguage("en");
  configureSharedHost("host", [], "machine");
  view = {
    id: "assistant", name: "Assistant", revision: 1, lifecycle: "idle",
    enabled: true, brainGeneration: 1,
    triggers: { user: true, event: true, schedule: true },
    policy: fullBotPolicy(),
  } as typeof view;
  getSession = async () => ({ projectId: project.id, session: { id: "target" } });
  mocks.rpc.mockImplementation(async (_machine: string, method: string) => {
    switch (method) {
      case "environment.describe": return { capabilities: ["assistant.v1"] };
      case "assistant.get": return view;
      case "assistant.messages": return { entries: [card], nextRevision: 1, hasMore: false };
      case "models.list": return { models: {}, errors: {} };
      case "projects.list": return [project];
      case "sessions.get": return getSession();
      default: return [];
    }
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  configureSharedHost(undefined, []);
  setSharedSessionBackend(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
async function render() {
  const props = {
    onLocalSession: local, onRemoteSession: remote,
  };
  act(() => root.render(createElement(DesktopBots, props)));
  await flush();
  mocks.rpc.mockClear();
  return node.querySelector<HTMLButtonElement>(".assistant-card button")!;
}
const requests = (method: string) => mocks.rpc.mock.calls.filter((call) => call[1] === method);

it("shows loading immediately, prevents repeat opens and reuses the validated local target", async () => {
  let finish!: () => void;
  local.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const button = await render();
  act(() => {
    button.click();
    button.click();
  });
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toBe("Opening…");
  expect(button.querySelector("svg.animate-spin.motion-reduce\\:animate-none")).not.toBeNull();
  await flush();
  expect(requests("assistant.get")).toHaveLength(1);
  expect(requests("projects.list")).toHaveLength(1);
  expect(requests("sessions.get")).toHaveLength(1);
  expect(local).toHaveBeenCalledExactlyOnceWith("target", project.cwd);
  expect(remoteProjectFor(project.cwd)?.projectId).toBe(project.id);
  expect(button.disabled).toBe(true);
  await act(async () => finish());
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute("aria-busy")).toBe(false);
  expect(button.textContent).toBe("Open session");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("clears loading after a failed open and allows retry", async () => {
  getSession = async () => { throw new Error("Conversation is unavailable"); };
  const button = await render();
  act(() => button.click());
  await flush();
  expect(button.disabled).toBe(false);
  expect(node.textContent).toContain("Conversation is unavailable");
  expect(local).not.toHaveBeenCalled();
  getSession = async () => ({ projectId: project.id, session: { id: "target" } });
  act(() => button.click());
  await flush();
  expect(local).toHaveBeenCalledOnce();
  expect(node.textContent).not.toContain("Conversation is unavailable");
});

it("rechecks permission before reading or opening the target", async () => {
  const button = await render();
  view = { ...view, policy: { ...fullBotPolicy(), allowedProjects: [] } };
  act(() => button.click());
  await flush();
  expect(requests("sessions.get")).toHaveLength(0);
  expect(local).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  expect(node.textContent).toContain("outside the assistant's current permissions");
});

it("reuses the validated target for remote navigation", async () => {
  configureSharedHost(undefined, []);
  const button = await render();
  act(() => button.click());
  await flush();
  expect(remote).toHaveBeenCalledExactlyOnceWith("remote://host/work/project", "target");
  expect(local).not.toHaveBeenCalled();
  expect(requests("projects.list")).toHaveLength(1);
  expect(requests("sessions.get")).toHaveLength(1);
});

it("keeps orchestration workers in the read-only detail view", async () => {
  getSession = async () => ({
    projectId: project.id, session: { id: "target", orchestrationLeadId: "lead" },
  });
  const button = await render();
  act(() => button.click());
  await flush();
  expect(node.textContent).toContain("Read-only worker");
  expect(local).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
});


it("separates same-ID attachment copies across Bot threads and reuses each thread's copy", async () => {
  const bots = ["A", "B"].map(id => ({
    ...view, id, name: id, defaultThreadId: `${id}-1`, createdAt: 1, updatedAt: 1, revision: 1, chatRevision: 1,
    harness: "codex", model: "default", modelSettings: {}, runtimeMode: "full-access", targetRuntimeMode: "full-access",
    policyVersion: 1, schedules: [], watches: [], maxAutoTurns: 8, chainWindowMinutes: 15,
  }));
  const threads = bots.map(bot => ({ botId: bot.id, id: bot.defaultThreadId, title: bot.defaultThreadId, kind: "direct", revision: 1, chatRevision: 1, createdAt: 1, updatedAt: 1, lifecycle: "idle" }));
  threads.push({ ...threads[0], id: "A-2", title: "A-2" });
  mocks.invoke.mockImplementation(async (command: string, params: { data: string }) => {
    if (command === "write_attachment") return `/local/${atob(params.data)}.txt`;
  });
  mocks.rpc.mockImplementation(async (_machine: string, method: string, params: Record<string, any>) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "assistant.history", "bots.shell.v1", "bots.v1"] };
    if (method === "bots.list") return { revision: 1, bots, threads, defaultBotId: "A", defaultThreadId: "A-1" };
    const bot = bots.find(bot => bot.id === params?.botId);
    if (method === "botThreads.get") return { ...bot, botId: bot!.id, threadId: params.threadId };
    if (method === "botThreads.messages") return { assistant: bot, entries: [{ id: "file-message", kind: "user", revision: 1, createdAt: 1, text: "Document", attachments: [{ id: "same-file-id", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 1 }] }], nextRevision: 1, hasMore: false };
    if (method === "attachments.read") return { data: btoa(params.threadId === "A-2" ? "C" : params.botId), offset: 1, size: 1 };
    throw new Error(method);
  });
  await render();
  const active = () => node.querySelector<HTMLElement>('.desktop-bots-thread-surface:not([aria-hidden])')!;
  const open = async () => { act(() => active().querySelector<HTMLButtonElement>('[aria-label="Open notes.txt"]')!.click()); await flush(); };
  await open(); await open();
  expect(requests("attachments.read")).toHaveLength(1);
  expect(mocks.openFile).toHaveBeenLastCalledWith("/local/A.txt");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Switch thread"]')!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="A-2"]')!.click()); await flush();
  await open();
  expect(mocks.openFile).toHaveBeenLastCalledWith("/local/C.txt");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="B"]')!.click()); await flush();
  await open();
  expect(requests("attachments.read").map(call => call[2])).toEqual([
    { botId: "A", threadId: "A-1", messageId: "file-message", id: "same-file-id", offset: 0 },
    { botId: "A", threadId: "A-2", messageId: "file-message", id: "same-file-id", offset: 0 },
    { botId: "B", threadId: "B-1", messageId: "file-message", id: "same-file-id", offset: 0 },
  ]);
  expect(mocks.openFile).toHaveBeenLastCalledWith("/local/B.txt");
  act(() => active().querySelector<HTMLButtonElement>('[title="A"]')!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Switch thread"]')!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="A-1"]')!.click()); await flush();
  await open();
  expect(requests("attachments.read")).toHaveLength(3);
  expect(mocks.openFile).toHaveBeenLastCalledWith("/local/A.txt");
});


it("keeps attachment reads and copy reuse compatible with the old assistant Host interface", async () => {
  const legacy = mocks.rpc.getMockImplementation()!;
  mocks.invoke.mockResolvedValue("/local/legacy.txt");
  mocks.rpc.mockImplementation(async (machine: string, method: string, params: unknown) => {
    if (method === "assistant.messages") return { entries: [{ id: "file-message", kind: "user", revision: 1, createdAt: 1, text: "Document", attachments: [{ id: "file", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 1 }] }], nextRevision: 1, hasMore: false };
    if (method === "attachments.read") return { data: btoa("L"), offset: 1, size: 1 };
    return legacy(machine, method, params);
  });
  await render();
  expect(node.querySelector(".desktop-bots-workspace")).toBeNull();
  const button = node.querySelector<HTMLButtonElement>('[aria-label="Open notes.txt"]')!;
  act(() => button.click()); await flush();
  act(() => button.click()); await flush();
  expect(requests("attachments.read").map(call => call[2])).toEqual([{ messageId: "file-message", id: "file", offset: 0 }]);
  expect(mocks.openFile).toHaveBeenLastCalledWith("/local/legacy.txt");
  expect(mocks.rpc.mock.calls.some(([, method]) => method.startsWith("bots.") || method.startsWith("botThreads."))).toBe(false);
});
