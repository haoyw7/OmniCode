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
  act(() => button("Runtime").click()); await flush();
  act(() => { input(field("Working directory"), ""); input(field("Concurrent runs"), "4"); });
  act(() => button("Save runtime settings").click()); await flush();
  expect(field("Concurrent runs").value).toBe("4"); expect(node.textContent).toContain("Connection lost");
  act(() => button("Save runtime settings").click()); await flush();
  expect(rpc.mock.calls).toHaveLength(2);
  expect(rpc.mock.calls[1][1]).toMatchObject({ botId: "bot-a", expectedRevision: 5, patch: { workingDirectory: null, maxConcurrentRuns: 4 } });
  expect(rpc.mock.calls[0][1].commandId).toBe(rpc.mock.calls[1][1].commandId);
  expect(button("Save runtime settings").disabled).toBe(true);
});

it("preserves a conflicting runtime draft until the user explicitly reloads", async () => {
  const latest = { ...bot(), revision: 7, maxConcurrentRuns: 8 };
  const rpc = vi.fn().mockRejectedValueOnce(new Error("Settings changed elsewhere. Reload before saving.")).mockResolvedValueOnce(latest);
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  act(() => button("Runtime").click()); await flush(); act(() => input(field("Concurrent runs"), "5"));
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
  act(() => button("Activity").click()); expect(node.textContent).toContain("active");
  expect(node.querySelector<HTMLElement>('[data-root="true"]')!.inert).toBe(true);
  act(() => node.querySelector("h3")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(node.textContent).toContain("hidden"); expect(node.querySelector("input")!.value).toBe("draft");
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
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: mine, rpc: rpc as never, onSaved: vi.fn(), delegationSupported: true })));
  expect(rpc).not.toHaveBeenCalled();
  act(() => button("Runtime").click()); await flush();
  const list = node.querySelector<HTMLElement>('[aria-label="Callable bots"]')!;
  expect(list.textContent).not.toContain("Test Bot");
  const options = [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(options).toHaveLength(1); expect(options[0].checked).toBe(false);
  act(() => options[0].click()); act(() => button("Save runtime settings").click()); await flush();
  expect(rpc.mock.calls.find(call => call[0] === "bots.configure")?.[1]).toMatchObject({ botId: "bot-a", expectedRevision: 5, patch: { callableBotIds: ["bot-b"] } });
});

it("omits delegation configuration and discovery when the Host lacks the capability", async () => {
  const rpc = vi.fn().mockResolvedValue({ revision: 6 });
  act(() => root.render(createElement(DesktopBotRuntimeSettings, { bot: bot(), rpc: rpc as never, onSaved: vi.fn() })));
  act(() => button("Runtime").click()); await flush();
  expect(node.querySelector('[aria-label="Callable bots"]')).toBeNull();
  act(() => input(field("Concurrent runs"), "4"));
  act(() => button("Save runtime settings").click()); await flush();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].patch).not.toHaveProperty("callableBotIds");
});


it("opens avatar editing from the avatar, cancels drafts and applies changes through Save", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: true, onSave: save })));
  expect(node.querySelectorAll("input")).toHaveLength(1);
  const trigger = node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!;
  act(() => trigger.click()); await flush();
  expect(document.activeElement).toBe(field("Avatar"));
  act(() => input(field("Avatar"), "🐱"));
  act(() => field("Avatar").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); await flush();
  expect(document.activeElement).toBe(trigger);
  expect(node.querySelector('[role="group"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  act(() => trigger.click()); await flush();
  expect(field("Avatar").value).toBe("");
  act(() => input(field("Avatar"), "🐱"));
  act(() => button("Apply").click()); await flush();
  expect(node.querySelector('.desktop-bot-avatar')?.textContent).toBe("🐱");
  act(() => node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush();
  expect(save).toHaveBeenCalledWith({ name: "Test Bot", avatar: "🐱" });
});

it("rejects oversized avatar drafts and keeps unsupported Hosts read-only", async () => {
  const save = vi.fn();
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: true, onSave: save })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click()); await flush();
  act(() => input(field("Avatar"), "123456789"));
  expect(button("Apply").disabled).toBe(true);
  act(() => field("Avatar").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(save).not.toHaveBeenCalled();
  expect(field("Avatar").getAttribute("aria-invalid")).toBe("true");
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: false, onSave: save })));
  expect(node.querySelector('[aria-label="Edit avatar"]')).toBeNull();
  expect(node.querySelectorAll("input")).toHaveLength(1);
});

it("preserves the generation prompt across avatar tabs without submitting or pretending to generate", async () => {
  const save = vi.fn();
  act(() => root.render(createElement(BotIdentitySettings, { bot: bot(), busy: false, avatarSupported: true, onSave: save })));
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="Edit avatar"]')!.click()); await flush();
  const tabs = [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  act(() => tabs[1].click());
  const prompt = node.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "A friendly orange cat");
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(node.querySelector<HTMLButtonElement>('.desktop-bot-avatar-generate')!.disabled).toBe(true);
  act(() => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[2]);
  act(() => tabs[1].click());
  expect(prompt.value).toBe("A friendly orange cat");
  expect(node.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain("Avatar image generation is not available yet.");
  expect(save).not.toHaveBeenCalled();
});
