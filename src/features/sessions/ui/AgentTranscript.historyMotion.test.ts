// @vitest-environment happy-dom
import { act, createElement, useContext, type ComponentProps } from "react";
import { createRoot } from "../../../../tests/helpers/sessionPresentationRoot";
import { type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptPlatformContext } from "../../../shared/ui/markdown/TranscriptPlatform";
import type { Block } from "../../../contracts/session";

vi.mock("../hooks/useTranscriptLayout", () => ({ useTranscriptLayout: () => "chat" }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function SlidingTranscript(props: ComponentProps<typeof AgentTranscript>) {
  const platform = useContext(TranscriptPlatformContext);
  return createElement(TranscriptPlatformContext.Provider, {
    value: { ...platform, messageMotion: "slide" },
  }, createElement(AgentTranscript, props));
}

function render(blocks: Block[], busy: boolean, animateFrom?: string) {
  act(() => root.render(createElement(SlidingTranscript, { blocks, busy, animateFrom })));
}

it.each([false, true])("shows asynchronously loaded history immediately, then animates fresh output (busy=%s)", (busy) => {
  const history: Block[] = [
    { id: "user", role: "user", text: "Review" },
    { id: "reply", role: "assistant", text: "已经收到的历史消息。".repeat(10), streaming: busy },
  ];
  render([], busy);
  render([], busy);
  render(history, busy);
  expect(container.querySelector("[data-prompt-rise]")).toBeNull();
  expect(container.querySelector(".agent-markdown")!.textContent).toBe(history[1].text);
  expect(container.querySelector("[data-transcript-content-motion]")?.getAttribute("style") ?? "").not.toContain("opacity: 0");

  const nextUser: Block = { id: "next-user", role: "user", text: "Continue" };
  render([...history, nextUser], true);
  expect(container.querySelector('[data-transcript-turn="next-user"]')?.getAttribute("data-prompt-rise")).toBe("rising");
  const fresh: Block = {
    id: "fresh", role: "assistant", text: "这是刚刚收到的新回复。".repeat(10), streaming: true,
  };
  render([...history, nextUser, fresh], true);

  const reply = container.querySelectorAll(".agent-markdown")[1]!;
  expect(reply.textContent!.length).toBeGreaterThan(0);
  expect(reply.textContent!.length).toBeLessThan(fresh.text.length);
});

it("does not introduce a prompt restored by a delayed history snapshot after switching back", () => {
  const cached: Block[] = [
    { id: "cached-user", role: "user", text: "Earlier prompt" },
    { id: "cached-reply", role: "assistant", text: "Earlier answer" },
  ];
  const show = (visible: boolean, blocks = cached, historyEntries?: Block[]) =>
    act(() => root.render(createElement(SlidingTranscript, { blocks, busy: true, visible, historyEntries })));
  show(true);
  const cachedNode = container.querySelector('[data-transcript-turn="cached-user"]');
  show(false);
  show(true);
  const restored: Block[] = [...cached,
    { id: "restored-user", role: "user", text: "Prompt sent while away" },
    { id: "restored-reply", role: "assistant", text: "Already running", streaming: true },
  ];
  show(true, restored, restored);
  expect(container.querySelector('[data-transcript-turn="cached-user"]')).toBe(cachedNode);
  expect(container.querySelector("[data-prompt-rise]")).toBeNull();
  expect(container.querySelectorAll(".agent-markdown")[1].textContent).toBe("Already running");
  const sent: Block[] = [...restored, { id: "fresh-user", role: "user", text: "Continue" }];
  show(true, sent, restored);
  expect(container.querySelector('[data-transcript-turn="fresh-user"]')?.getAttribute("data-prompt-rise")).toBe("rising");
});

it("still animates an explicitly fresh reply in the first loaded snapshot", () => {
  const blocks: Block[] = [
    { id: "old-user", role: "user", text: "Hello" },
    { id: "old-reply", role: "assistant", text: "已有回复。" },
    { id: "new-user", role: "user", text: "Review" },
    { id: "new-reply", role: "assistant", text: "刚收到的回复。".repeat(10), streaming: true },
  ];
  render([], true, "new-user");
  render(blocks, true, "new-user");
  expect(container.querySelector('[data-transcript-turn="new-user"]')?.getAttribute("data-prompt-rise")).toBe("rising");
  const replies = container.querySelectorAll(".agent-markdown");
  expect(replies[0].textContent).toBe(blocks[1].text);
  expect(replies[1].textContent!.length).toBeGreaterThan(0);
  expect(replies[1].textContent!.length).toBeLessThan(blocks[3].text.length);
  expect(replies[1].closest<HTMLElement>("[data-transcript-content-motion]")?.style.opacity).toBe("0");
});
