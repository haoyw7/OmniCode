// @vitest-environment happy-dom
import { act, createElement, createRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileBots } from "./MobileBots";
import type { MobileAssistantHandle } from "./MobileAssistant";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../shared/i18n/language";

const capture = vi.hoisted(() => ({ props: undefined as any }));
vi.mock("./MobileAssistant", () => ({ MobileAssistant: (props: any) => {
  capture.props = props;
  useImperativeHandle(props.ref, () => ({ back: props.onClose }));
  return createElement("button", { onClick: props.onClose }, "Chat back");
} }));
vi.mock("../features/bots/ui/BotAvatar", () => ({ BotAvatar: () => null }));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  capture.props = undefined;
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
const bot = (id: string) => ({ id, name: `Bot ${id}`, defaultThreadId: `${id}-thread` });
function setup(bots = [bot("a")], legacy = false) {
  const rpc = vi.fn(async (method: string) => {
    if (method === "environment.describe") return { capabilities: legacy ? ["assistant.v1"] : ["bots.v1", "assistant.timeline"] };
    if (method === "bots.list") return { bots, threads: [], defaultBotId: "a", defaultThreadId: "a-thread" };
    if (method === "assistant.get") return bot("a");
    return {};
  });
  const ref = createRef<MobileAssistantHandle>(), onClose = vi.fn();
  const render = async (visible = true, foreground = true) => {
    await act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
      createElement(MobileBots, { ref, open: true, foreground, rpc: rpc as any, hostKey: "host", hostName: "Host", onClose }))));
  };
  const click = async (text: string) => {
    await act(async () => [...node.querySelectorAll("button")].find(button => button.textContent === text)!.click());
  };
  return { rpc, ref, onClose, render, click };
}
it("requires selection even for one Bot, returns to the list, and reopens at the list", async () => {
  const f = setup(); await f.render();
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
