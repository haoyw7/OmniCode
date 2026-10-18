// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { startMotionClock, stopMotionClock, finishMotion as settleMotion } from "../../../../tests/helpers/sharedMotionClock";
import { DesktopBotsWorkspace } from "./DesktopBotsWorkspace";
import { fullBotPolicy, type BotMessage } from "../model/botView";
import { botCacheKey, type BotView, type BotThread, type BotsSnapshot } from "../model/bots";
import type { BotTeam } from "../model/botTeams";
import type { BotRoom, BotRoomRound } from "../model/botRooms";
import { setUiLanguage } from "../../../shared/i18n/language";

let node: HTMLDivElement, root: Root;
const bot = (id: string): BotView => ({
  id, name: id, defaultThreadId: `${id}-1`, createdAt: 1, updatedAt: 1, revision: 1, chatRevision: 0,
  lifecycle: "idle", enabled: true, harness: "codex", model: "default-model", modelSettings: {},
  runtimeMode: "full-access", targetRuntimeMode: "full-access", policy: fullBotPolicy(), policyVersion: 1,
  triggers: { user: true, event: false, schedule: false }, schedules: [], watches: [], maxAutoTurns: 8, chainWindowMinutes: 15, brainGeneration: 1,
});
const thread = (botId: string, id: string): BotThread => ({ botId, id, title: id, kind: "direct", createdAt: 1, updatedAt: 1, revision: 1, lifecycle: "idle", chatRevision: 0 });
let snapshot: BotsSnapshot;
let messages: Record<string, BotMessage[]>;
let rpc: ReturnType<typeof vi.fn>;
let memorySupported: boolean;
let runtimeSupported: boolean;
let managementSupported: boolean;
let delegationSupported: boolean;
let teamsSupported: boolean, roomsSupported: boolean;
let teams: BotTeam[], rooms: BotRoom[], rounds: BotRoomRound[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  localStorage.clear();
  setUiLanguage("en");
  snapshot = { revision: 1, bots: [bot("A"), bot("B")], threads: [thread("A", "A-1"), thread("A", "A-2"), thread("B", "B-1")], defaultBotId: "A", defaultThreadId: "A-1" };
  messages = {};
  memorySupported = false; runtimeSupported = false; managementSupported = false; delegationSupported = false; teamsSupported = false; roomsSupported = false;
  teams = [{ id: "team", name: "Design team", memberBotIds: ["A", "B"], chiefBotId: "A", revision: 1, createdAt: 1, updatedAt: 1 }];
  rooms = [{ id: "room", name: "Design room", memberIds: ["A", "B"], memberTimeoutMs: 240000, revision: 1, chatRevision: 0, activityRevision: 0, createdAt: 1, updatedAt: 1 }];
  rounds = [];
  const view = (id: string) => {
    const target = snapshot.threads.find((thread) => thread.id === id)!;
    const owner = snapshot.bots.find((bot) => bot.id === target.botId)!;
    return { ...owner, ...target.modelOverride, botId: target.botId, threadId: target.id, title: target.title, chatRevision: target.chatRevision };
  };
  rpc = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1", "assistant.history", "bots.shell.v1", "bots.v1", ...(memorySupported ? ["botMemory.v1"] : []), ...(runtimeSupported ? ["bots.runtime.v1"] : []), ...(managementSupported ? ["bots.management.v1"] : []), ...(delegationSupported ? ["bots.delegation.v1"] : []), ...(teamsSupported ? ["bots.teams.v1"] : []), ...(roomsSupported ? ["bots.rooms.v1"] : [])] };
    if (method === "botTeams.list") return { revision: 1, teams };
    if (method === "botRooms.list") return { revision: 1, rooms };
    if (method === "botRooms.get") return { room: rooms.find(room => room.id === params.roomId), rounds };
    if (method === "botRooms.messages") return { revision: 0, messages: [], hasMore: false };
    if (method === "botMemory.list") return { revision: 1, files: [], topicLimit: 100, topicsTruncated: false };
    if (method === "botMemory.read") return { path: params.path, text: `${params.botId} memory`, kind: "resident", revision: 1, hash: params.botId, bytes: 8, updatedAt: 1 };
    if (method === "botDelegations.get") return { id: params.delegationId, source: { botId: "A", threadId: "A-1", runId: "parent-run" }, target: { botId: "B", threadId: "B-1", runId: "child-run" }, requestId: "request", prompt: "Review", status: "running", createdAt: 1, updatedAt: 1, deadlineAt: 240001 };
    if (method === "botDelegations.list") return { revision: 1, delegations: [], hasMore: false };
    if (method === "botThreads.runs") return { revision: 1, runs: [], hasMore: false };
    if (method === "bots.list") return { ...snapshot, threads: [...snapshot.threads] };
    if (method === "botThreads.get") return view(params.threadId);
    if (method === "botThreads.messages") {
      const entries = messages[params.threadId] ?? [];
      return { assistant: view(params.threadId), entries: params.latest ? entries.slice(-params.limit) : entries.filter((message) => message.revision > params.afterRevision), nextRevision: view(params.threadId).chatRevision, hasMore: false };
    }
    if (method === "models.list") return { models: { codex: [{ id: "default-model", name: "Default model" }, { id: "thread-model", name: "Thread model" }] }, errors: {} };
    if (method === "projects.list") return [];
    if (method === "bots.create") {
      const created = { ...bot("C"), ...params.patch };
      const createdThread = thread("C", "C-1");
      snapshot = { ...snapshot, bots: [...snapshot.bots, created], threads: [...snapshot.threads, createdThread] };
      return { bot: created, thread: createdThread };
    }
    if (method === "botThreads.create") {
      const created = { ...thread(params.botId, `${params.botId}-new`), title: params.title };
      snapshot = { ...snapshot, threads: [...snapshot.threads, created] };
      return created;
    }
    if (method === "botThreads.configure") {
      const current = snapshot.threads.find((thread) => thread.id === params.threadId)!;
      if (params.expectedRevision !== current.revision) throw new Error("Thread configuration changed elsewhere");
      const updated = { ...current, ...params.patch, modelOverride: params.patch.modelOverride ?? undefined, revision: current.revision + 1 };
      snapshot = { ...snapshot, threads: snapshot.threads.map((thread) => thread.id === current.id ? updated : thread) };
      return updated;
    }
    if (method === "bots.archive" || method === "bots.restore") {
      const current = snapshot.bots.find((bot) => bot.id === params.botId)!;
      if (method === "bots.archive" && current.id === snapshot.defaultBotId) throw new Error("Default bot");
      const updated = { ...current, archivedAt: method === "bots.archive" ? Date.now() : undefined, revision: current.revision + 1 };
      snapshot = { ...snapshot, bots: snapshot.bots.map((bot) => bot.id === current.id ? updated : bot) };
      return updated;
    }
    if (method === "botThreads.archive" || method === "botThreads.restore") {
      const current = snapshot.threads.find((thread) => thread.id === params.threadId)!;
      const updated = { ...current, archivedAt: method === "botThreads.archive" ? Date.now() : undefined, revision: current.revision + 1 };
      snapshot = { ...snapshot, threads: snapshot.threads.map((thread) => thread.id === current.id ? updated : thread) };
      return updated;
    }
    if (method === "botThreads.send" || method === "bots.configure") return { accepted: true };
    throw new Error(`Unexpected RPC ${method}`);
  });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); stopMotionClock(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await settleMotion(); }); }
async function render() {
  act(() => root.render(createElement(DesktopBotsWorkspace, { hostKey: "host", hostName: "Host", rpc: rpc as never, onOpen: () => {}, desktopBots: true })));
  await flush();
}
const active = () => node.querySelector<HTMLElement>('.desktop-bots-thread-surface:not([aria-hidden])')!;
const composer = () => active().querySelector<HTMLTextAreaElement>('.assistant-conversation textarea')!;
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function select(label: string) {
  if (/^[AB]-/.test(label)) {
    if (!active().querySelector(`[title="${label[0]}"][aria-current="true"]`)) {
      act(() => active().querySelector<HTMLButtonElement>(`button[title="${label[0]}"]`)!.click()); await flush();
    }
    act(() => active().querySelector<HTMLButtonElement>('[aria-label="Switch thread"]')!.click()); await flush();
  }
  act(() => active().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  await flush();
}
it("retains per-thread drafts and scroll state while routing sends only to the selected scope", async () => {
  await render();
  act(() => setValue(composer(), "Draft A1"));
  const first = composer();
  const log = active().querySelector<HTMLElement>(".assistant-messages")!;
  act(() => { log.scrollTop = 123; log.dispatchEvent(new Event("scroll")); });
  await select("B");
  expect(composer().value).toBe("");
  act(() => setValue(composer(), "Draft B1"));
  await select("A-2");
  expect(composer().value).toBe("");
  act(() => setValue(composer(), "Draft A2"));
  await select("A-1");
  expect(composer()).toBe(first);
  expect(composer().value).toBe("Draft A1");
  expect(log.scrollTop).toBe(123);
  act(() => active().querySelector<HTMLButtonElement>(".assistant-send")!.click());
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botThreads.send")?.[1]).toMatchObject({ botId: "A", threadId: "A-1", text: "Draft A1" });
  await select("B");
  expect(composer().value).toBe("Draft B1");
  expect(localStorage.getItem(`monocode.assistant-draft:${botCacheKey("host", { botId: "A", threadId: "A-2" })}`)).toBe("Draft A2");
  expect(rpc.mock.calls.some(([method]) => method.startsWith("assistant."))).toBe(false);
});
it("creates a Bot only after saving its editable draft and creates a named Thread after submission", async () => {
  await render();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="New bot"]')!.click());
  await flush();
  const draft = node.querySelector<HTMLElement>('.desktop-bots-create:not([aria-hidden])')!;
  act(() => [...draft.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent === "Create new Bot")!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(360); }); await flush();
  expect(rpc.mock.calls.some(([method]) => method === "bots.create")).toBe(false);
  const name = [...draft.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Assistant name"))!.querySelector("input")!;
  act(() => setValue(name, "New colleague"));
  expect(rpc.mock.calls.some(([method]) => method === "bots.create")).toBe(false);
  act(() => draft.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "bots.create")?.[1].patch.name).toBe("New colleague");
  expect(active().textContent).toContain("New colleague");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Switch thread"]')!.click()); await flush();
  const newThread = [...active().querySelectorAll<HTMLButtonElement>('[aria-label="New thread"]')].at(-1)!;
  act(() => newThread.click());
  const field = node.querySelector<HTMLInputElement>('[aria-label="Thread name"]')!;
  act(() => setValue(field, "Planning"));
  expect(rpc.mock.calls.some(([method]) => method === "botThreads.create")).toBe(false);
  act(() => field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botThreads.create")?.[1]).toMatchObject({ botId: "C", title: "Planning" });
  expect(active().querySelector(".desktop-bots-header-title")?.textContent).toContain("Planning");
});
it("edits Bot defaults without copying a Thread model override", async () => {
  snapshot.threads[0].modelOverride = { harness: "codex", model: "thread-model" };
  await render();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click());
  await flush();
  act(() => [...active().querySelectorAll<HTMLButtonElement>('.desktop-bot-settings-links button')].find(button => button.textContent === "Runtime")!.click()); await flush();
  const panel = active().querySelector<HTMLElement>(".desktop-bots-inspector")!;
  const name = [...panel.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Assistant name"))!.querySelector("input")!;
  act(() => setValue(name, "Renamed A"));
  act(() => name.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(rpc.mock.calls.find(([method]) => method === "bots.configure")?.[1]).toMatchObject({ botId: "A", patch: { model: "default-model" } });
});


it("labels an empty stored default title without mutating it", async () => {
  snapshot.threads[0].title = "";
  await render();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Switch thread"]')!.click()); await flush();
  const row = active().querySelector<HTMLButtonElement>('[role="menuitem"][aria-current="page"]')!;
  expect(row.getAttribute("aria-label")).toBe("Main thread");
  expect(row.textContent).toContain("Main thread");
  expect(snapshot.threads[0].title).toBe("");
});

it("shares file drafts across a Bot's threads, keeps Bots isolated, and retains drafts when details close", async () => {
  memorySupported = true;
  await render();
  expect(rpc.mock.calls.some(([method]) => method.startsWith("botMemory."))).toBe(false);
  const openFiles = async () => {
    act(() => active().querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click()); await flush();
    act(() => [...active().querySelectorAll<HTMLButtonElement>('.desktop-bot-settings-links button')].find((button) => button.textContent === "Memory files")!.click()); await flush();
  };
  const contents = () => active().querySelector<HTMLTextAreaElement>('[aria-label="File contents"]')!;
  await openFiles();
  act(() => setValue(contents(), "Shared A draft"));
  await select("A-2"); await openFiles();
  expect(contents().value).toBe("Shared A draft");
  await select("B"); await openFiles();
  expect(contents().value).toBe("B memory");
  act(() => setValue(contents(), "Private B draft"));
  await select("A-1");
  expect(contents().value).toBe("Shared A draft");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Hide bot details"]')!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click()); await flush();
  expect(contents().value).toBe("Shared A draft");
  expect(rpc.mock.calls.filter(([method]) => method.startsWith("botMemory.")).every(([, params]) => !Object.hasOwn(params, "threadId"))).toBe(true);
});

async function details() {
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click()); await flush();
  act(() => [...active().querySelectorAll<HTMLButtonElement>('.desktop-bot-settings-links button')].find(button => button.textContent === "Thread settings")!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>(".desktop-bots-management-toggle")!.click()); await flush();
}
function managementButton(text: string) {
  return [...active().querySelectorAll<HTMLButtonElement>(".desktop-bots-thread-settings button")].find((button) => button.textContent === text)!;
}
async function archives() {
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Archived bots and threads"]')!.click()); await flush();
  return node.querySelector<HTMLElement>('.desktop-bots-create:not([aria-hidden])')!;
}
it("protects default scopes and restores an archived Thread with its draft and scroll intact", async () => {
  await render(); await details();
  expect(managementButton("Archive bot").disabled).toBe(true);
  expect(managementButton("Archive thread").disabled).toBe(true);
  await select("A-2");
  act(() => setValue(composer(), "Pending thread reply"));
  const field = composer();
  const log = active().querySelector<HTMLElement>(".assistant-messages")!;
  act(() => { log.scrollTop = 88; log.dispatchEvent(new Event("scroll")); });
  await details();
  act(() => managementButton("Archive thread").click()); await flush();
  expect(active().querySelector('.desktop-bots-thread-trigger')?.textContent).toContain("A-1");
  expect(active().querySelector('[aria-label="A-2"]')).toBeNull();
  const archive = await archives();
  const restore = archive.querySelector<HTMLButtonElement>('[aria-label="Restore thread: A-2"]')!;
  expect(restore).not.toBeNull();
  act(() => restore.click()); await flush();
  expect(composer()).toBe(field);
  expect(composer().value).toBe("Pending thread reply");
  expect(log.scrollTop).toBe(88);
  act(() => active().querySelector<HTMLButtonElement>(".assistant-send")!.click()); await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botThreads.send")?.[1]).toMatchObject({ botId: "A", threadId: "A-2", text: "Pending thread reply" });
  expect(rpc.mock.calls.filter(([method]) => method === "bots.list").every(([, params]) => params?.includeArchived === true)).toBe(true);
});

it("restores an archived Bot and keeps its independent draft and user avatar", async () => {
  snapshot.bots[1].avatar = "🐱";
  await render(); await select("B");
  expect(active().querySelector('[aria-label="B"] .desktop-bot-avatar')?.textContent).toContain("🐱");
  act(() => setValue(composer(), "Bot B draft"));
  await details();
  act(() => managementButton("Archive bot").click()); await flush();
  expect(active().querySelector('[aria-label="B"]')).toBeNull();
  const archive = await archives();
  expect(archive.querySelector(".desktop-bots-archive-thread")?.textContent).toContain("B-1");
  expect(archive.querySelector(".desktop-bots-archive-thread svg, .desktop-bots-archive-thread img")).not.toBeNull();
  act(() => archive.querySelector<HTMLButtonElement>('[aria-label="Restore bot: B"]')!.click()); await flush();
  expect(composer().value).toBe("Bot B draft");
  expect(active().querySelector('[aria-label="B"]')).not.toBeNull();
});

it("saves a Thread title and model override, then resets the override to follow its Bot", async () => {
  await render(); await select("A-2"); await details();
  const title = active().querySelector<HTMLInputElement>('[aria-label="Thread title"]')!;
  const follow = active().querySelector<HTMLInputElement>('.desktop-bots-model-follow input')!;
  act(() => { setValue(title, "Planning title"); follow.click(); }); await flush();
  const model = active().querySelector<HTMLSelectElement>('[aria-label="Thread model override"]')!;
  act(() => { model.value = "thread-model"; model.dispatchEvent(new Event("change", { bubbles: true })); });
  act(() => managementButton("Save thread").click()); await flush();
  const saved = rpc.mock.calls.find(([method]) => method === "botThreads.configure")?.[1];
  expect(saved).toMatchObject({ botId: "A", threadId: "A-2", expectedRevision: 1, patch: { title: "Planning title", modelOverride: { harness: "codex", model: "thread-model" } } });
  expect(active().querySelector('.desktop-bots-thread-trigger')?.textContent).toContain("Planning title");
  expect(snapshot.bots[0].model).toBe("default-model");
  act(() => follow.click());
  // Content remains mounted during closing and AnimatedCollapse owns inertness.
  expect(active().querySelector('[aria-label="Thread model override"]')).not.toBeNull();
  act(() => managementButton("Save thread").click()); await flush();
  expect(rpc.mock.calls.filter(([method]) => method === "botThreads.configure").at(-1)?.[1]).toMatchObject({ expectedRevision: 2, patch: { modelOverride: null } });
  expect(snapshot.threads.find((thread) => thread.id === "A-2")?.modelOverride).toBeUndefined();
});

it("keeps a conflicting Thread edit until the user explicitly resets it", async () => {
  await render(); await select("A-2"); await details();
  const title = active().querySelector<HTMLInputElement>('[aria-label="Thread title"]')!;
  act(() => setValue(title, "My unsaved title"));
  snapshot = { ...snapshot, threads: snapshot.threads.map((thread) => thread.id === "A-2" ? { ...thread, title: "External title", revision: 9 } : thread) };
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); }); await flush();
  act(() => managementButton("Save thread").click()); await flush();
  expect(title.value).toBe("My unsaved title");
  expect(active().querySelector('.desktop-bots-thread-settings [role="alert"]')?.textContent).toContain("changed elsewhere");
  act(() => managementButton("Reset thread draft").click());
  expect(title.value).toBe("External title");
});

it("gates new management fields while exposing scoped activity on a Stage 4 Host", async () => {
  runtimeSupported = true;
  await render(); await details();
  expect(active().querySelector(".desktop-bot-runtime")).toBeNull();
  expect([...active().querySelectorAll('.desktop-bot-settings-links button')].some(tab => tab.textContent === "Automation")).toBe(false);
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Back to settings"]')!.click()); await flush();
  const activity = [...active().querySelectorAll<HTMLButtonElement>('.desktop-bot-settings-links button')].find(tab => tab.textContent === "Activity")!;
  act(() => activity.click()); await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botThreads.runs")?.[1]).toMatchObject({ botId: "A", threadId: "A-1" });
});
it("offers automation on a management-capable Host and returns archive keyboard focus", async () => {
  runtimeSupported = true; managementSupported = true;
  await render(); await details();
  expect([...active().querySelectorAll(".desktop-bot-settings-links button")].some(button => button.textContent === "Runtime")).toBe(true);
  expect([...active().querySelectorAll('.desktop-bot-settings-links button')].some(tab => tab.textContent === "Automation")).toBe(true);
  const archive = await archives();
  expect(document.activeElement).toBe(archive.querySelector(".desktop-bots-archive h2"));
  act(() => archive.querySelector(".desktop-bots-archive h2")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(30); }); await flush();
  expect(document.activeElement).toBe(active().querySelector(".desktop-bots-archive-entry"));
});

it("renders scoped delegation messages and opens the target Thread for its independent approvals", async () => {
  delegationSupported = true;
  snapshot.threads[2].kind = "delegation";
  snapshot.threads[0].chatRevision = 1;
  messages["A-1"] = [{ id: "status1", revision: 1, createdAt: 1, kind: "status", text: "Delegation running", delegationId: "d1" }];
  await render();
  expect(active().querySelector(".desktop-bot-delegation-card")?.textContent).toContain("A → B");
  expect(rpc.mock.calls.find(([method]) => method === "botDelegations.get")?.[1]).toEqual({ botId: "A", threadId: "A-1", delegationId: "d1" });
  act(() => [...active().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open target thread")!.click()); await flush();
  expect(active().querySelector('.desktop-bots-thread-trigger')?.textContent).toContain("B-1");
  expect(composer().disabled).toBe(true);
  expect(active().textContent).toContain("Delegation threads accept approvals and questions.");
  expect(rpc.mock.calls.some(([method]) => method === "botThreads.respond")).toBe(false);
});

it("keeps status text without delegation queries on a Host without delegation capability", async () => {
  snapshot.threads[0].chatRevision = 1;
  messages["A-1"] = [{ id: "status1", revision: 1, createdAt: 1, kind: "status", text: "Delegation running", delegationId: "d1" }];
  await render();
  expect(active().textContent).toContain("Delegation running");
  expect(active().querySelector(".desktop-bot-delegation-card")).toBeNull();
  expect(rpc.mock.calls.some(([method]) => method.startsWith("botDelegations."))).toBe(false);
});


it("gates Team and Room navigation and RPCs on their independent Host capabilities", async () => {
  await render();
  expect(active().querySelector('[aria-label="Manage teams"]')).toBeNull();
  expect(active().querySelector('[aria-label="Manage rooms"]')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); }); await flush();
  expect(rpc.mock.calls.some(([method]) => method.startsWith("botTeams.") || method.startsWith("botRooms."))).toBe(false);
});

it("shows the team's Chief and preserves an unsaved team draft when returning from a Bot", async () => {
  teamsSupported = true;
  await render();
  expect(active().querySelector('.desktop-bots-team-heading')?.textContent).toContain("Design team");
  expect(active().querySelector('[aria-label="A"] .desktop-bots-chief')?.textContent).toBe("Chief");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Manage teams"]')!.click()); await flush();
  const directory = () => node.querySelector<HTMLElement>('.desktop-bot-management-surface:not([hidden])')!;
  act(() => [...directory().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "New team")!.click());
  const name = directory().querySelector<HTMLInputElement>('[aria-label="Team name"]')!;
  act(() => setValue(name, "Unfinished team"));
  expect(rpc.mock.calls.some(([method]) => method === "botTeams.create")).toBe(false);
  const shell = node.querySelector<HTMLElement>('.desktop-bots-create:not([aria-hidden])')!;
  act(() => shell.querySelector<HTMLButtonElement>('[aria-label="B"]')!.click()); await flush();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Manage teams"]')!.click()); await flush();
  expect(directory().querySelector<HTMLInputElement>('[aria-label="Team name"]')).toBe(name);
  expect(name.value).toBe("Unfinished team");
  expect(rpc.mock.calls.some(([method]) => method.startsWith("botRooms."))).toBe(false);
});

it("retains a Room draft and scroll across its member approval thread while pausing hidden Room polling", async () => {
  roomsSupported = true;
  snapshot.threads[2].kind = "room";
  rounds = [{ id: "round", roomId: "room", userMessageId: "request", status: "running", roomRevision: 1, memberTimeoutMs: 240000, createdAt: 1, updatedAt: 1, speakers: [{ botId: "B", threadId: "B-1", status: "waiting_approval" }] }];
  await render();
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Design room"]')!.click()); await flush();
  const room = () => node.querySelector<HTMLElement>('.desktop-bots-room-surface:not([aria-hidden])')!;
  const field = room().querySelector<HTMLTextAreaElement>('[aria-label="Message room"]')!;
  act(() => setValue(field, "Room draft"));
  const log = room().querySelector<HTMLElement>('.desktop-bot-room-messages')!;
  Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });
  act(() => { log.scrollTop = 71; log.dispatchEvent(new Event('scroll')); });
  act(() => room().querySelector<HTMLButtonElement>('[aria-label="Open member thread: B"]')!.click()); await flush();
  expect(composer().disabled).toBe(true);
  expect(active().textContent).toContain("Room member threads accept approvals and questions.");
  const count = rpc.mock.calls.filter(([method]) => method === "botRooms.get").length;
  await act(async () => { await vi.advanceTimersByTimeAsync(4100); }); await flush();
  expect(rpc.mock.calls.filter(([method]) => method === "botRooms.get")).toHaveLength(count);
  expect(rpc.mock.calls.some(([method]) => method === "botThreads.respond")).toBe(false);
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Design room"]')!.click()); await flush();
  expect(room().querySelector('[aria-label="Message room"]')).toBe(field);
  expect(field.value).toBe("Room draft");
  expect(log.scrollTop).toBe(71);
  expect(rpc.mock.calls.some(([method]) => method.startsWith("botTeams."))).toBe(false);
});

async function recipient() {
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="New bot"]')!.click()); await flush();
  return node.querySelector<HTMLInputElement>('[role="combobox"]')!;
}
async function key(field: HTMLElement, value: string) {
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); await flush();
}
async function finishMotion() { await act(async () => { await vi.advanceTimersByTimeAsync(360); }); await flush(); }

it("pins without duplicate rows, keeps pins searchable and drops an archived Bot", async () => {
  await render();
  act(() => active().querySelector<HTMLElement>('[title="B"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 }))); await flush();
  const pin = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes("Pin Bot"))!;
  act(() => pin.click()); await flush();
  expect(JSON.parse(localStorage.getItem("monocode.bot-pins:host")!)).toEqual(["B"]);
  expect(active().querySelector('.desktop-bots-pinned')?.textContent).toBe("B");
  expect(active().querySelector('.desktop-bots-contacts [title="B"]')).toBeNull();
  await select("B");
  act(() => active().querySelector<HTMLButtonElement>('[aria-label="Bot details"]')!.click()); await flush();
  expect(active().querySelector<HTMLButtonElement>('.desktop-bot-identity [aria-pressed]')?.getAttribute('aria-pressed')).toBe('true');
  const search = active().querySelector<HTMLInputElement>('[aria-label="Search bots"]')!;
  act(() => setValue(search, "B")); await finishMotion();
  expect(active().querySelector('.desktop-bots-pinned [title="B"]')?.getAttribute('aria-current')).toBe('true');
  expect(active().querySelector('.desktop-bots-contacts [title="B"]')).toBeNull();
  expect(active().querySelector('.desktop-bots-no-results')).toBeNull();
  act(() => setValue(search, "missing")); await finishMotion();
  expect(active().querySelector('.desktop-bots-pinned')).toBeNull();
  expect(active().querySelector('.desktop-bots-no-results')).not.toBeNull();
  act(() => setValue(search, "")); await flush();
  snapshot = { ...snapshot, bots: snapshot.bots.map(bot => bot.id === "B" ? { ...bot, archivedAt: 1 } : bot) };
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); }); await flush();
  expect(JSON.parse(localStorage.getItem("monocode.bot-pins:host")!)).toEqual([]);
  await finishMotion();
  expect(active().querySelector('.desktop-bots-pinned')).toBeNull();
});

it("opens the last thread with picker arrows and Enter, filters results, and closes with Escape", async () => {
  localStorage.setItem("monocode.bot-selection:host", JSON.stringify({ botId: "A", threadId: "A-2" }));
  await render(); await select("B");
  const field = await recipient();
  expect(node.querySelector('.desktop-bots-create:not([aria-hidden]) .desktop-bots-draft-row')?.textContent).toBe("New");
  expect(field.getAttribute("aria-expanded")).toBe("true");
  act(() => setValue(field, "A")); await key(field, "ArrowDown"); await key(field, "Enter"); await finishMotion();
  expect(active().querySelector('.desktop-bots-thread-trigger')?.textContent).toContain("A-2");
  const next = await recipient(); await key(next, "Escape"); await finishMotion();
  expect(active().querySelector('.desktop-bots-thread-trigger')?.textContent).toContain("A-2");
  expect(node.querySelector('.desktop-bots-create:not([aria-hidden])')).toBeNull();
  expect(document.activeElement).toBe(active().querySelector('[aria-label="New bot"]'));
});

it("hides multi-recipient hints on older Hosts and keeps Tab as ordinary navigation", async () => {
  await render(); const field = await recipient();
  await key(field, "ArrowDown"); await key(field, "Tab");
  expect(node.querySelector('.desktop-bot-recipient-chip')).toBeNull();
  expect(node.querySelector('.desktop-bot-recipient-menu')?.textContent).not.toContain("Tab to add");
  await key(field, "ArrowUp"); await key(field, "Enter"); await finishMotion();
  expect(node.querySelector('.desktop-bots-create:not([aria-hidden]) .assistant-settings')).not.toBeNull();
  expect(rpc.mock.calls.some(([method]) => method === "bots.create")).toBe(false);
});

it("creates an ordered room from Tab recipients and retries a failed send without creating another room", async () => {
  roomsSupported = true;
  const base = rpc.getMockImplementation()!; let fail = true;
  rpc.mockImplementation(async (method, params) => {
    if (method === "botRooms.create") { const room = { ...rooms[0], id: "new-room", name: params.name, memberIds: params.memberIds }; rooms.push(room); return room; }
    if (method === "botRooms.send") { if (fail) { fail = false; throw Error("Connection lost"); } return { accepted: true }; }
    return base(method, params);
  });
  await render(); const field = await recipient();
  await key(field, "ArrowDown"); await key(field, "Tab");
  await key(field, "ArrowDown"); await key(field, "Tab");
  expect([...node.querySelectorAll('.desktop-bot-recipient-chip')].map(chip => chip.textContent)).toEqual(["A", "B"]);
  const message = node.querySelector<HTMLTextAreaElement>('[aria-label="Room message"]')!;
  act(() => setValue(message, "Review together"));
  await key(message, "Enter");
  expect(node.querySelector('.desktop-bot-recipient-error')?.textContent).toBe("Connection lost");
  await key(message, "Enter"); await finishMotion();
  expect(rpc.mock.calls.filter(([method]) => method === "botRooms.create")).toHaveLength(1);
  const creation = rpc.mock.calls.find(([method]) => method === "botRooms.create")![1];
  expect(creation.memberIds).toEqual(["A", "B"]);
  const sends = rpc.mock.calls.filter(([method]) => method === "botRooms.send");
  expect(sends).toHaveLength(2); expect(sends[1][1]).toEqual(sends[0][1]);
  expect(sends[1][1]).toMatchObject({ roomId: "new-room", text: "Review together" });
  expect(node.querySelector('.desktop-bots-room-surface:not([aria-hidden])')).not.toBeNull();
});

it("clamps and shares the sidebar width across retained thread surfaces", async () => {
  await render();
  const separator = () => active().querySelector<HTMLElement>('[aria-label="Resize sidebar"]')!;
  act(() => separator().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  await flush();
  expect(localStorage.getItem("monocode.bots-sidebar-width")).toBe("400");
  await select("B");
  expect(separator().getAttribute("aria-valuenow")).toBe("400");
  act(() => separator().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  await flush();
  expect(separator().getAttribute("aria-valuenow")).toBe("400");
  act(() => separator().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  await flush();
  await select("A-1");
  expect(separator().getAttribute("aria-valuenow")).toBe("240");
  expect(active().querySelector<HTMLElement>(".desktop-bots-workspace")!.style.getPropertyValue("--bots-sidebar-preference")).toBe("240px");
});


it("unpins from the pinned card keyboard menu and restores the ordinary row", async () => {
  localStorage.setItem("monocode.bot-pins:host", JSON.stringify(["B"]));
  await render();
  const card = active().querySelector<HTMLButtonElement>('.desktop-bots-pinned [title="B"]')!;
  await key(card, "ContextMenu");
  const unpin = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes("Unpin Bot"))!;
  act(() => unpin.click()); await finishMotion();
  expect(active().querySelector('.desktop-bots-pinned')).toBeNull();
  expect(active().querySelectorAll('.desktop-bots-contacts [title="B"]')).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem("monocode.bot-pins:host")!)).toEqual([]);
});
