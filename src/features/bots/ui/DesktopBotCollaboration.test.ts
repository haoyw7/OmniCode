// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBotTeams } from "./DesktopBotTeams";
import { DesktopRoomEditor } from "./DesktopBotRooms";
import { DesktopBotRoomChat } from "./DesktopBotRoomChat";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../../../shared/i18n/language";
import { fullBotPolicy } from "../model/botView";
import type { BotView } from "../model/bots";
import type { BotTeam } from "../model/botTeams";
import type { BotRoom, BotRoomMessage, BotRoomRound } from "../model/botRooms";
let node: HTMLDivElement, root: Root;
const bot = (id: string): BotView => ({ id, name: id, revision: 1, chatRevision: 0, enabled: true, lifecycle: "idle", harness: "codex", model: "test", modelSettings: {}, runtimeMode: "full-access", targetRuntimeMode: "full-access", policy: fullBotPolicy(), policyVersion: 1, brainGeneration: 1, maxAutoTurns: 8, chainWindowMinutes: 15, triggers: { user: true, event: true, schedule: true }, schedules: [], watches: [], defaultThreadId: `${id}-1`, createdAt: 1, updatedAt: 1 });
const bots = [bot("Alpha"), bot("Beta")];
const room = (id = "room-1"): BotRoom => ({ id, name: id, memberIds: ["Alpha", "Beta"], memberTimeoutMs: 240000, revision: 1, chatRevision: 0, activityRevision: 0, createdAt: 1, updatedAt: 1 });
const team = (): BotTeam => ({ id: "team-1", name: "Core team", memberBotIds: ["Alpha", "Beta"], chiefBotId: "Alpha", revision: 1, createdAt: 1, updatedAt: 1 });
const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!;
function input(field: HTMLInputElement | HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }
const choice = (label: string) => [...node.querySelectorAll<HTMLLabelElement>("label")].find(value => value.textContent === label)!.querySelector<HTMLInputElement>("input")!;
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); setUiLanguage("en"); vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))); node = document.createElement("div"); document.body.append(node); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("creates a Team only on save and preserves a competing Chief edit until explicit reload", async () => {
  let teams = [team()];
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => {
    if (method === "botTeams.configure") throw new Error("Team changed elsewhere");
    if (method === "botTeams.get") return { ...team(), chiefBotId: "Beta", revision: 2 };
    if (method === "botTeams.create") { const created = { ...team(), id: "team-new", ...params.patch }; teams = [...teams, created]; return created; }
    throw new Error(method);
  });
  const render = () => act(() => root.render(createElement(DesktopBotTeams, { teams, bots, rpc: rpc as never, onSaved: async () => render() })));
  render(); act(() => button("New team").click()); await flush();
  act(() => { input(node.querySelector<HTMLInputElement>('[aria-label="Team name"]')!, "Draft team"); choice("Alpha").click(); });
  expect(rpc).not.toHaveBeenCalled();
  act(() => button("Create team").click()); await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botTeams.create")?.[1].patch).toMatchObject({ name: "Draft team", memberBotIds: ["Alpha"], chiefBotId: null });
  act(() => [...node.querySelectorAll<HTMLButtonElement>(".desktop-bot-directory-list button")].find(value => value.textContent?.startsWith("Core team"))!.click());
  const editor = node.querySelector<HTMLElement>('.desktop-bot-directory-editors > div:not([hidden])')!;
  const chief = editor.querySelector<HTMLSelectElement>('[aria-label="Chief of Staff"]')!;
  act(() => { chief.value = "Beta"; chief.dispatchEvent(new Event("change", { bubbles: true })); });
  act(() => editor.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()); await flush();
  expect(chief.value).toBe("Beta"); expect(editor.textContent).toContain("Team changed elsewhere");
  expect(rpc.mock.calls.find(([method]) => method === "botTeams.configure")?.[1]).toMatchObject({ teamId: "team-1", expectedRevision: 1, patch: { chiefBotId: "Beta" } });
  act(() => [...editor.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === "Reload saved configuration")!.click()); await flush();
  expect(chief.value).toBe("Beta"); expect(editor.querySelector('[role="alert"]')).toBeNull();
});

it("saves a Room's ordered member draft with a stable retry command", async () => {
  let first = true;
  const rpc = vi.fn(async (_method: string, params: Record<string, any>) => { if (first) { first = false; throw new Error("Connection lost"); } return { ...room(), name: params.name, memberIds: params.memberIds }; });
  act(() => root.render(createElement(DesktopRoomEditor, { bots, rpc: rpc as never, onSaved: async () => {} })));
  act(() => { input(node.querySelector<HTMLInputElement>('[aria-label="Room name"]')!, "Planning"); choice("Alpha").click(); choice("Beta").click(); });
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Move up: Beta"]')!.click());
  expect(rpc).not.toHaveBeenCalled();
  expect(node.querySelector<HTMLInputElement>('[aria-label="Room name"]')!.value).toBe("Planning");
  expect(button("Create room").disabled).toBe(false);
  act(() => button("Create room").click()); await flush(); expect(node.textContent).toContain("Connection lost");
  act(() => button("Create room").click()); await flush();
  expect(rpc.mock.calls[0][1]).toMatchObject({ name: "Planning", memberIds: ["Beta", "Alpha"], memberTimeoutMs: 240000 });
  expect(rpc.mock.calls[0][1].commandId).toBe(rpc.mock.calls[1][1].commandId);
});

it("uses room order by default, supports per-round order, and retains unsent text on retry", async () => {
  const value = room(); let fail = false;
  const rpc = vi.fn(async (method: string, _params: Record<string, any>) => {
    if (method === "botRooms.get") return { room: value, rounds: [] };
    if (method === "botRooms.messages") return { revision: 0, messages: [], hasMore: false };
    if (method === "botRooms.send") { if (fail) { fail = false; throw new Error("Connection lost"); } return {}; }
    throw new Error(method);
  });
  act(() => root.render(createElement(DesktopBotRoomChat, { environmentId: "host-a", room: value, bots, rpc: rpc as never, onSaved: async () => {}, onOpenThread: vi.fn() }))); await flush();
  const field = node.querySelector<HTMLTextAreaElement>('[aria-label="Message room"]')!;
  act(() => input(field, "Default order")); act(() => node.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()); await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botRooms.send")?.[1]).not.toHaveProperty("memberIds");
  act(() => button("This round's speakers").click()); act(() => choice("Use room member order").click());
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Move up: Beta"]')!.click());
  fail = true; act(() => input(field, "Specific order")); act(() => node.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()); await flush();
  expect(field.value).toBe("Specific order");
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click()); await flush();
  const sends = rpc.mock.calls.filter(([method]) => method === "botRooms.send");
  expect(sends[1][1]).toMatchObject({ roomId: "room-1", memberIds: ["Beta", "Alpha"], text: "Specific order" });
  expect(sends[1][1].commandId).toBe(sends[2][1].commandId); expect(field.value).toBe("");
});

it("shows member failure and approval state, opens its member thread, and stops only the selected round", async () => {
  const value = room();
  const active: BotRoomRound = { id: "round-active", roomId: value.id, userMessageId: "u", status: "running", roomRevision: 1, memberTimeoutMs: 240000, speakers: [{ botId: "Alpha", status: "failed", error: "Member failed" }, { botId: "Beta", threadId: "beta-room", status: "waiting_approval" }], createdAt: 1, updatedAt: 1 };
  const queued = { ...active, id: "round-queued", status: "queued", speakers: [] };
  const rpc = vi.fn(async (method: string, _params: Record<string, any>) => {
    if (method === "botRooms.get") return { room: value, rounds: [active, queued] };
    if (method === "botRooms.messages") return { revision: 0, messages: [], hasMore: false };
    if (method === "botRooms.cancel") return { ...active, status: "cancelled" };
    throw new Error(method);
  });
  const open = vi.fn();
  act(() => root.render(createElement(DesktopBotRoomChat, { environmentId: "host-a", room: value, bots, rpc: rpc as never, onSaved: async () => {}, onOpenThread: open }))); await flush();
  expect(node.textContent).toContain("Member failed"); expect(node.textContent).toContain("Approval needed");
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Open member thread: Beta"]')!.click()); expect(open).toHaveBeenCalledWith({ botId: "Beta", threadId: "beta-room" });
  act(() => node.querySelector<HTMLButtonElement>('[data-round-id="round-active"] header button')!.click()); await flush();
  expect(rpc.mock.calls.filter(([method]) => method === "botRooms.cancel").map(([, params]) => params)).toEqual([expect.objectContaining({ roomId: value.id, roundId: "round-active" })]);
});

it("keeps older history when new pages arrive and stops polling a hidden Room", async () => {
  let latest = 4;
  const value = room();
  const message = (sequence: number): BotRoomMessage => ({ id: `m${sequence}`, roomId: value.id, roundId: "round", sequence, kind: "user", text: `Message ${sequence}`, createdAt: sequence });
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => {
    if (method === "botRooms.get") return { room: { ...value, chatRevision: latest }, rounds: [] };
    if (method === "botRooms.messages") { const end = params.before ? params.before.sequence - 1 : latest; const start = Math.max(1, end - 1); return { revision: latest, messages: [message(start), message(end)], hasMore: start > 1, next: start > 1 ? { sequence: start, id: `m${start}` } : undefined }; }
    throw new Error(method);
  });
  const render = (visible: boolean) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(DesktopBotRoomChat, { environmentId: "host-a", room: value, bots, rpc: rpc as never, onSaved: async () => {}, onOpenThread: vi.fn() }))));
  render(true); await flush(); act(() => button("Load older messages").click()); await flush(); expect(node.textContent).toContain("Message 1");
  latest = 8; await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); await flush();
  expect(node.querySelectorAll(".desktop-bot-room-message")).toHaveLength(8); expect(node.textContent).toContain("Message 1"); expect(node.textContent).toContain("Message 8");
  const field = node.querySelector<HTMLTextAreaElement>('[aria-label="Message room"]')!; act(() => input(field, "Retained"));
  render(false); const count = rpc.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(rpc).toHaveBeenCalledTimes(count);
  render(true); await flush(); expect(field.value).toBe("Retained");
});

it("isolates persisted Room drafts by Host and Room identity", async () => {
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => method === "botRooms.get" ? { room: room(params.roomId), rounds: [] } : { revision: 0, messages: [], hasMore: false });
  const render = async (environmentId: string, id: string) => { act(() => root.render(createElement(DesktopBotRoomChat, { environmentId, room: room(id), bots, rpc: rpc as never, onSaved: async () => {}, onOpenThread: vi.fn() }))); await flush(); };
  const field = () => node.querySelector<HTMLTextAreaElement>('[aria-label="Message room"]')!;
  await render("host-a", "room-1"); act(() => input(field(), "A one"));
  await render("host-b", "room-1"); expect(field().value).toBe(""); act(() => input(field(), "B one"));
  await render("host-a", "room-2"); expect(field().value).toBe("");
  await render("host-a", "room-1"); expect(field().value).toBe("A one");
});


it("keeps a Room configuration conflict draft, then archives and restores with its saved revision", async () => {
  let current = room(), conflict = true;
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => {
    if (method === "botRooms.get") return { room: current, rounds: [] };
    if (method === "botRooms.configure") {
      if (conflict) throw new Error("Settings changed elsewhere. Reload before saving.");
      current = { ...current, ...params.patch, revision: current.revision + 1 }; return current;
    }
    if (method === "botRooms.archive" || method === "botRooms.restore") {
      expect(params.expectedRevision).toBe(current.revision);
      current = { ...current, revision: current.revision + 1, archivedAt: method.endsWith("archive") ? 5 : undefined }; return current;
    }
    throw new Error(method);
  });
  const render = () => act(() => root.render(createElement(DesktopRoomEditor, { room: current, bots, rpc: rpc as never, onSaved: async () => render() })));
  render();
  const name = node.querySelector<HTMLInputElement>('[aria-label="Room name"]')!;
  act(() => input(name, "Unpublished rename"));
  current = { ...current, name: "External rename", revision: 7 }; render();
  act(() => button("Save room").click()); await flush();
  expect(name.value).toBe("Unpublished rename");
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Settings changed elsewhere");
  act(() => button("Reload saved configuration").click()); await flush();
  expect(name.value).toBe("External rename");
  conflict = false;
  act(() => button("Archive room").click()); await flush();
  expect(node.querySelector('fieldset')?.disabled).toBe(true);
  act(() => button("Restore room").click()); await flush();
  expect(node.querySelector('fieldset')?.disabled).toBe(false);
  act(() => input(name, "Restored rename"));
  act(() => button("Save room").click()); await flush();
  expect(current.name).toBe("Restored rename");
  expect(rpc.mock.calls.filter(([method]) => method === "botRooms.configure").at(-1)?.[1]).toMatchObject({ roomId: "room-1", expectedRevision: 9 });
});
