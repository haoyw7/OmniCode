// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBotRuntimeSettings } from "./DesktopBotRuntimeSettings";
import { DesktopBotActivity } from "./DesktopBotActivity";
import { BotIdentitySettings } from "./BotIdentitySettings";
import { DesktopBotDetails } from "./DesktopBotDetails";
import { DesktopBotAutomation } from "./DesktopBotAutomation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../../../shared/i18n/language";
import { fullBotPolicy } from "../model/botView";
import type { BotRun, BotView } from "../model/bots";

let node: HTMLDivElement, root: Root;
const bot = (): BotView => ({ id: "bot-a", name: "Test Bot", revision: 5, chatRevision: 0, enabled: true, lifecycle: "idle", harness: "codex", model: "codex:test", modelSettings: {}, runtimeMode: "supervised", targetRuntimeMode: "supervised", policy: fullBotPolicy(), policyVersion: 1, brainGeneration: 1, maxAutoTurns: 8, chainWindowMinutes: 15, triggers: { user: true, event: true, schedule: true }, schedules: [{ id: "hourly", enabled: true, intervalMinutes: 60, prompt: "Review", timezone: "UTC", nextRunAt: 1 }], watches: [], defaultThreadId: "thread-a", createdAt: 1, updatedAt: 1, workingDirectory: "/project", maxConcurrentRuns: 3 });
const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
const input = (field: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); };
const field = (text: string) => [...node.querySelectorAll<HTMLLabelElement>("label")].find(item => item.textContent === text)!.querySelector<HTMLInputElement>("input")!;
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); setUiLanguage("en");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps a runtime draft and command identity after an unknown response, and sends null to clear the directory", async () => {
  const rpc = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ revision: 6 });
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  act(() => { node.querySelector<HTMLButtonElement>('[aria-label="Clear working directory"]')!.click(); input(field("Concurrent runs"), "4"); });
  act(() => button("Save runtime settings").click()); await flush();
  expect(field("Concurrent runs").value).toBe("4"); expect(node.textContent).toContain("Connection lost");
  act(() => button("Save runtime settings").click()); await flush();
  expect(rpc.mock.calls).toHaveLength(2);
  expect(rpc.mock.calls[1][1].patch).not.toHaveProperty("avatar");
  expect(rpc.mock.calls[1][1]).toMatchObject({ botId: "bot-a", expectedRevision: 5, patch: { workingDirectory: null, maxConcurrentRuns: 4 } });
  expect(rpc.mock.calls[0][1].commandId).toBe(rpc.mock.calls[1][1].commandId);
  expect(button("Save runtime settings")).toBeUndefined();
});

it("picks the working directory by browsing folders on the Bot's Host", async () => {
  const rpc = vi.fn(async (method: string, params?: Record<string, any>) => {
    if (method === "projects.browse") return params?.path === "/project/app"
      ? { path: "/project/app", parent: "/project", entries: [] }
      : { path: "/project", parent: "/", entries: [{ name: "app", path: "/project/app" }] };
    if (method === "bots.configure") return { revision: 6 };
    throw new Error(method);
  });
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Choose working directory"]')!.click()); await flush();
  expect(rpc).toHaveBeenCalledWith("projects.browse", { path: "/project" });
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "app")!.click()); await flush();
  act(() => button("Use this folder").click()); await flush();
  act(() => button("Save runtime settings").click()); await flush();
  expect(rpc.mock.calls.find(call => call[0] === "bots.configure")?.[1]).toMatchObject({ patch: { workingDirectory: "/project/app" } });
});

it("preserves a conflicting runtime draft until the user explicitly reloads", async () => {
  const latest = { ...bot(), revision: 7, maxConcurrentRuns: 8 };
  const rpc = vi.fn().mockRejectedValueOnce(new Error("Settings changed elsewhere. Reload before saving.")).mockResolvedValueOnce(latest);
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  act(() => input(field("Concurrent runs"), "5"));
  act(() => button("Save runtime settings").click()); await flush();
  expect(field("Concurrent runs").value).toBe("5"); expect(button("Save runtime settings").disabled).toBe(true);
  act(() => button("Reload saved configuration").click()); await flush(); expect(field("Concurrent runs").value).toBe("8");
});

it("refreshes loaded older activity through shifting cursors and stops polling while hidden", async () => {
  vi.useFakeTimers(); let changed = false;
  const run = (id: string, at: number, status: BotRun["status"]): BotRun => ({ id, botId: "bot-a", threadId: "thread-a", wakeupId: id, attempt: 1, status, createdAt: at, updatedAt: at, config: { revision: 5, harness: "codex", model: id, modelSettings: {}, runtimeMode: "supervised", policyVersion: 1 } });
  const rpc = vi.fn(async (_method: string, params: Record<string, any>) => {
    const at = params.before?.createdAt ?? (changed ? 4 : 3);
    const value = at > 3 ? run("new", 3, "queued") : at > 2 ? run("recent", 2, "completed") : run("older", 1, changed ? "completed" : "running");
    return { revision: changed ? 2 : 1, runs: [value], hasMore: value.id !== "older", next: value.id === "older" ? undefined : { createdAt: value.createdAt, id: value.id } };
  });
  const render = (visible: boolean) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(DesktopBotActivity, { scope: { botId: "bot-a", threadId: "thread-a" }, rpc: rpc as never }))));
  render(true); await flush(); act(() => button("Load older runs").click()); await flush(); expect(node.textContent).toContain("Running");
  changed = true; await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); await flush();
  expect(node.textContent).not.toContain("Running"); expect(node.textContent).toContain("older"); expect(node.textContent).toContain("new");
  expect(rpc.mock.calls.at(-1)![1].before).toEqual({ createdAt: 2, id: "recent" });
  render(false); const count = rpc.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(rpc).toHaveBeenCalledTimes(count);
  expect(rpc.mock.calls.every(call => call[1].botId === "bot-a" && call[1].threadId === "thread-a")).toBe(true);
});

it("returns from subpages with Escape, preserves visited drafts, and disables hidden activity", async () => {
  function Visible() { return createElement("span", null, useSurfaceVisibility() ? "active" : "hidden"); }
  act(() => root.render(createElement(DesktopBotDetails, { identity: createElement("input", { defaultValue: "draft" }), children: createElement("p", null, "runtime"), memory: createElement("p", null, "memory"), activity: createElement(Visible) })));
  act(() => button("Settings").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await flush();
  act(() => button("Activity").click()); await flush(); expect(node.textContent).toContain("active");
  expect(node.querySelector<HTMLElement>('[data-root="true"]')!.inert).toBe(true);
  act(() => node.querySelector("h3")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await flush();
  expect(node.textContent).toContain("hidden"); expect(node.querySelector("input")!.value).toBe("draft");
  act(() => button("Details").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await flush();
  expect(node.querySelector<HTMLElement>('[data-root="true"]')!.inert).toBe(false);
});

it("saves only automation fields with a stable revision and retry command while retaining a failed draft", async () => {
  const saves: Record<string, any>[] = []; let failed = true;
  const rpc = vi.fn(async (method: string, params: Record<string, any>) => {
    if (method === "models.list") return { models: {}, errors: {} };
    if (method === "projects.list") return [];
    if (method === "bots.configure") { saves.push(params); if (failed) { failed = false; throw new Error("Connection lost"); } return { revision: 6 }; }
    throw new Error(method);
  });
  act(() => root.render(createElement(DesktopBotAutomation, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() }))); await flush();
  const disclosure = [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes("Assistant wakeups"))!;
  act(() => disclosure.click()); await flush();
  const interval = node.querySelector<HTMLInputElement>('[aria-label="Interval"]')!;
  act(() => input(interval, "2")); act(() => button("Save automation").click()); await flush();
  expect(interval.value).toBe("2"); act(() => button("Save automation").click()); await flush();
  expect(saves).toHaveLength(2); expect(saves[1].commandId).toBe(saves[0].commandId); expect(saves[1].expectedRevision).toBe(5);
  expect(saves[1].patch).toMatchObject({ schedules: [{ intervalMinutes: 120 }] });
  expect(saves[1].patch).not.toHaveProperty("model"); expect(saves[1].patch).not.toHaveProperty("name"); expect(saves[1].patch).not.toHaveProperty("policy");
});

it("limits callable choices to other active Bots on this Host and saves the explicit allowlist", async () => {
  const mine = bot(), other = { ...bot(), id: "bot-b", name: "Research Bot" };
  const rpc = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
    if (method === "bots.list") return { revision: 1, bots: [mine, other, { ...other, id: "archived", archivedAt: 1 }], threads: [] };
    if (method === "bots.configure") return { revision: 6 };
    throw new Error(method);
  });
  const render = (visible: boolean) => act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement(DesktopBotRuntimeSettings, { bot: mine, rpc: rpc as never, onSaved: vi.fn(), delegationSupported: true }))));
  render(false); await flush();
  expect(rpc).not.toHaveBeenCalled();
  render(true); await flush();
  const list = node.querySelector<HTMLElement>('[aria-label="Callable bots"]')!;
  expect(list.textContent).not.toContain("Test Bot");
  const options = [...list.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  expect(options).toHaveLength(1); expect(options[0].getAttribute("aria-checked")).toBe("false");
  act(() => options[0].click()); act(() => button("Save runtime settings").click()); await flush();
  expect(rpc.mock.calls.find(call => call[0] === "bots.configure")?.[1]).toMatchObject({ botId: "bot-a", expectedRevision: 5, patch: { callableBotIds: ["bot-b"] } });
});

it("omits delegation configuration and discovery when the Host lacks the capability", async () => {
  const rpc = vi.fn().mockResolvedValue({ revision: 6 });
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  expect(node.querySelector('[aria-label="Callable bots"]')).toBeNull();
  act(() => input(field("Concurrent runs"), "4"));
  act(() => button("Save runtime settings").click()); await flush();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].patch).not.toHaveProperty("callableBotIds");
});


const avatarOption = (label: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][aria-label="${label}"]`)!;
const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".desktop-bot-avatar-dialog button")].find(item => item.textContent === text)!;
const preview = () => document.querySelector(".desktop-bot-avatar-dialog-preview svg");

it("previews Omi choices in a dialog, cancels drafts and saves the selected shape, expression, fill and color", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: true, onSave: save })));
  const trigger = node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!;
  act(() => { trigger.focus(); trigger.click(); }); await flush();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute("type")).toBe("radio");
  act(() => avatarOption("Triangle").click());
  expect(preview()?.getAttribute("data-shape")).toBe("triangle");
  expect(trigger.querySelector("svg")?.getAttribute("data-shape")).not.toBe("triangle");
  act(() => avatarOption("Triangle").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); await flush();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(save).not.toHaveBeenCalled();
  act(() => { trigger.focus(); trigger.click(); }); await flush();
  act(() => { avatarOption("Square").click(); });
  act(() => { avatarOption("Joyful").click(); });
  act(() => { avatarOption("Filled").click(); });
  act(() => { avatarOption("Blue").click(); });
  expect(preview()?.getAttribute("data-shape")).toBe("square");
  expect(preview()?.getAttribute("data-expression")).toBe("joyful");
  expect(preview()?.getAttribute("data-variant")).toBe("filled");
  expect(preview()?.getAttribute("style")).toContain("--color-omi-blue");
  act(() => dialogButton("Save").click()); await flush();
  expect(save).toHaveBeenCalledWith({ name: "Test Bot", avatar: "omi:3311" });
  expect(trigger.querySelector("svg")?.getAttribute("data-shape")).toBe("square");
  act(() => root.render(createElement(BotIdentitySettings, { key: "saved", bot: { ...bot(), avatar: "omi:3311" }, busy: false, avatarSupported: true, onSave: save })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click()); await flush();
  for (const label of ["Square", "Joyful", "Filled", "Blue"]) expect(avatarOption(label).checked).toBe(true);
});

it("can reset a saved appearance and keeps unsupported Hosts read-only", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(createElement(BotIdentitySettings, { bot: { ...bot(), avatar: "omi:3311" }, busy: false, avatarSupported: true, onSave: save })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click()); await flush();
  act(() => dialogButton("Reset").click());
  act(() => dialogButton("Save").click()); await flush();
  expect(save).toHaveBeenCalledWith({ name: "Test Bot", avatar: "" });
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: false, onSave: save })));
  expect(node.querySelector('[aria-label="Edit avatar"]')).toBeNull();
  expect(node.querySelectorAll("input")).toHaveLength(1);
});

it("preserves the generation prompt across avatar tabs without submitting or pretending to generate", async () => {
  const save = vi.fn();
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: true, onSave: save })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click()); await flush();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  act(() => tabs[1].click());
  const prompt = document.querySelector<HTMLTextAreaElement>('.desktop-bot-avatar-dialog textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "A friendly orange cat");
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector<HTMLButtonElement>('.desktop-bot-avatar-generate')!.disabled).toBe(true);
  act(() => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[2]);
  act(() => tabs[1].click());
  expect(prompt.value).toBe("A friendly orange cat");
  expect(document.querySelector('.desktop-bot-avatar-dialog [role="tabpanel"]:not([hidden])')?.textContent).toContain("Avatar image generation is not available yet.");
  expect(save).not.toHaveBeenCalled();
});
