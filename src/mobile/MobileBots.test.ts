// @vitest-environment happy-dom
import { act, createElement, createRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileBots } from "./MobileBots";
import type { MobileAssistantHandle } from "./MobileAssistant";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../shared/i18n/language";
import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
import { readBotPins, writeBotPins } from "../features/bots/model/botPins";

const capture = vi.hoisted(() => ({ props: undefined as any }));
vi.mock("./MobileAssistant", () => ({ MobileAssistantSelect: () => null, MobileAssistant: (props: any) => {
  capture.props = props;
  useImperativeHandle(props.ref, () => ({ back: props.onClose }));
  return createElement("button", { onClick: props.onClose }, "Chat back");
} }));
vi.mock("../features/bots/ui/BotAvatar", () => ({ BotAvatar: () => null }));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  vi.useFakeTimers();
  startMotionClock();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  capture.props = undefined;
  localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); node.remove(); stopMotionClock(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const bot = (id: string) => ({ id, name: `Bot ${id}`, defaultThreadId: `${id}-thread` });
function setup(bots = [bot("a")], legacy = false) {
  const rpc = vi.fn(async (method: string, _params?: object): Promise<any> => {
    if (method === "environment.describe") return { capabilities: legacy ? ["assistant.v1"] : ["bots.v1", "assistant.timeline"] };
    if (method === "bots.list") return { bots, threads: [], defaultBotId: "a", defaultThreadId: "a-thread" };
    if (method === "assistant.get") return bot("a");
    return {};
  });
  const ref = createRef<MobileAssistantHandle>(), onClose = vi.fn();
  const render = async (visible = true, foreground = true) => {
    await act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
      createElement(MobileBots, { ref, foreground, rpc: rpc as any, hostKey: "host", hostName: "Host", onClose }))));
    await advanceMotionTimers(500);
  };
  const click = async (text: string) => {
    await act(async () => [...node.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === text || button.textContent === text)!.click());
    await advanceMotionTimers(500);
  };
  return { rpc, ref, onClose, render, click };
}
it("requires selection even for one Bot, returns to the list, and reopens at the list", async () => {
  const f = setup(); await f.render();
  expect(node.querySelector(".mobile-bots")?.closest(".mobile-page-layer")).not.toBeNull();
  expect(node.querySelector(".mobile-page-overlay, .mobile-assistant-overlay")).toBeNull();
  expect(node.textContent).toContain("Bot a"); expect(capture.props).toBeUndefined();
  await f.click("Bot a"); expect(node.textContent).toContain("Chat back");
  await f.render(true, false); await f.render(); // App backgrounding preserves the route.
  expect(node.textContent).toContain("Chat back");
  await act(async () => f.ref.current!.back());
  expect(node.textContent).toContain("Bot a"); expect(f.onClose).not.toHaveBeenCalled();
  await f.click("Bot a"); await f.render(false); await f.render();
  expect(node.textContent).toContain("Bot a"); expect(node.textContent).not.toContain("Chat back");
  await act(async () => f.ref.current!.back()); expect(f.onClose).toHaveBeenCalledOnce();
});
it("scopes a selected non-default Bot's history and send without exposing the default timeline", async () => {
  const f = setup([bot("a"), bot("b")]); await f.render(); await f.click("Bot b");
  await capture.props.rpc("assistant.messages", { latest: true });
  expect(f.rpc).toHaveBeenLastCalledWith("botThreads.messages", { latest: true, botId: "b", threadId: "b-thread" });
  await capture.props.rpc("assistant.send", { text: "hello" });
  expect(f.rpc).toHaveBeenLastCalledWith("botThreads.send", { text: "hello", botId: "b", threadId: "b-thread" });
  expect(capture.props.cacheKey).toBe(JSON.stringify(["host", "b", "b-thread"]));
  expect((await capture.props.rpc("environment.describe")).capabilities).not.toContain("assistant.timeline");
  await f.click("Chat back"); await f.click("Bot a");
  expect(capture.props.rpc).toBe(f.rpc); expect(capture.props.cacheKey).toBe("host");
});
it("shows an empty list and supports a legacy Host without auto-opening its assistant", async () => {
  const empty = setup([]); await empty.render(); expect(node.textContent).toContain("No bots yet");
  const legacy = setup(undefined, true); await legacy.render();
  expect(node.textContent).toContain("Bot a"); expect(capture.props).toBeUndefined();
  await legacy.click("Bot a"); expect(capture.props.rpc).toBe(legacy.rpc);
});
it("shows loading and a retryable list error without opening a conversation", async () => {
  const f = setup();
  let reject!: (error: Error) => void;
  f.rpc.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await f.render(); expect(node.querySelector('[role="status"]')?.textContent).toContain("Loading…");
  await act(async () => reject(new Error("Offline")));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Offline");
  expect(capture.props).toBeUndefined();
  await f.click("Retry"); expect(node.textContent).toContain("Bot a");
});

it("separates stored pins, filters both sections, and closes search before leaving", async () => {
  writeBotPins("host", ["b"]);
  const f = setup([bot("a"), bot("b")]); await f.render();
  expect(node.querySelector('.mobile-bots-pinned [data-bot-id="b"]')).not.toBeNull();
  expect(node.querySelector('.mobile-bots-rows [data-bot-id="b"]')).toBeNull();
  await f.click("Search bots");
  const input = node.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "bot a");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await advanceMotionTimers(500);
  expect(node.querySelector('[data-bot-id="a"]')).not.toBeNull();
  expect(node.querySelector('[data-bot-id="b"]')).toBeNull();
  await act(async () => f.ref.current!.back()); await advanceMotionTimers(500);
  expect(f.onClose).not.toHaveBeenCalled();
  expect(node.querySelector('.mobile-bots-pinned [data-bot-id="b"]')).not.toBeNull();
});

it("pins and unpins through the Bot actions without opening chat", async () => {
  const f = setup([bot("a"), bot("b")]); await f.render();
  const menu = async () => {
    await act(async () => node.querySelector('[data-bot-id="b"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await advanceMotionTimers(500);
  };
  await menu();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")].find(button => button.textContent === "Pin")!.click());
  await advanceMotionTimers(500);
  expect(readBotPins("host")).toEqual(["b"]);
  expect(node.querySelector('.mobile-bots-pinned [data-bot-id="b"]')).not.toBeNull();
  expect(capture.props).toBeUndefined();
  await menu();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")].find(button => button.textContent === "Unpin")!.click());
  await advanceMotionTimers(500);
  expect(readBotPins("host")).toEqual([]);
  expect(node.querySelector('.mobile-bots-rows [data-bot-id="b"]')).not.toBeNull();
});

it("creates only on form submission and reuses the command ID after a failed request", async () => {
  const f = setup();
  const base = f.rpc.getMockImplementation()!;
  let fail = true;
  f.rpc.mockImplementation(async (method: string, ...args: any[]) => {
    if (method === "models.list") return { models: { codex: [{ id: "model", name: "Model" }] }, errors: {} };
    if (method === "projects.list") return [];
    if (method === "bots.create") {
      if (fail) throw new Error("Offline");
      return { bot: bot("new"), thread: { id: "new-thread" } };
    }
    return base(method, args[0]);
  });
  await f.render(); await f.click("New bot");
  expect(f.rpc.mock.calls.some(([method]) => method === "bots.create")).toBe(false);
  await f.click("Create bot");
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Offline");
  fail = false;
  await f.click("Create bot");
  const commands = (f.rpc.mock.calls as any[]).filter(([method]) => method === "bots.create");
  expect(commands).toHaveLength(2);
  expect(commands[0][1].commandId).toBe(commands[1][1].commandId);
  expect(capture.props.cacheKey).toBe(JSON.stringify(["host", "new", "new-thread"]));
});

it("keeps creation unavailable on legacy Hosts", async () => {
  const f = setup(undefined, true); await f.render();
  expect(node.querySelector<HTMLButtonElement>('[aria-label="New bot"]')?.disabled).toBe(true);
});

it("opens touch actions on hold, suppresses the tap, and yields to scrolling", async () => {
  const f = setup(); await f.render();
  const row = node.querySelector('[data-bot-id="a"]')!;
  const pointer = (type: string, y = 40) => row.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 40, clientY: y, button: 0,
  }));
  act(() => { pointer("pointerdown"); pointer("pointermove", 80); });
  await advanceMotionTimers(500);
  expect(document.querySelector('[aria-label="Bot options"]')).toBeNull();
  act(() => { pointer("pointerup", 80); pointer("pointerdown"); });
  await advanceMotionTimers(500);
  expect(document.querySelector('[aria-label="Bot options"]')).not.toBeNull();
  act(() => { pointer("pointerup"); (row as HTMLButtonElement).click(); });
  expect(capture.props).toBeUndefined();
});

it("shows the latest message and timestamp while retaining the list on a refresh failure", async () => {
  const f = setup();
  const base = f.rpc.getMockImplementation()!;
  let offline = false;
  f.rpc.mockImplementation(async (method, params) => {
    if (method === "bots.list") {
      if (offline) throw new Error("Offline");
      return { bots: [bot("a")], threads: [{ id: "a-thread", botId: "a", chatRevision: 1 }] };
    }
    if (method === "botThreads.messages") return {
      entries: [{ id: "reply", kind: "assistant", text: "Review ready", revision: 1, createdAt: 1000 }],
      nextRevision: 1, hasMore: false,
    };
    return base(method, params);
  });
  await f.render();
  expect(node.querySelector('.mobile-bots-row-preview')?.textContent).toContain("Review ready");
  expect(node.querySelector('time')?.dateTime).toBe(new Date(1000).toISOString());
  offline = true;
  await advanceMotionTimers(5500);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain("Offline");
  expect(node.querySelector('[data-bot-id="a"]')).not.toBeNull();
});
