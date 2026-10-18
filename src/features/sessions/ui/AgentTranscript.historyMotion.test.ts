// @vitest-environment happy-dom
import { act, createElement, useContext, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import type { Block } from "../model/session";

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
  expect(container.querySelector(".agent-markdown")!.textContent).toBe(history[1].text);
  expect(container.querySelector("[data-transcript-content-motion]")?.getAttribute("style") ?? "").not.toContain("opacity: 0");

  const nextUser: Block = { id: "next-user", role: "user", text: "Continue" };
  render([...history, nextUser], true);
  const fresh: Block = {
    id: "fresh", role: "assistant", text: "这是刚刚收到的新回复。".repeat(10), streaming: true,
  };
  render([...history, nextUser, fresh], true);

  const reply = container.querySelectorAll(".agent-markdown")[1]!;
  expect(reply.textContent!.length).toBeGreaterThan(0);
  expect(reply.textContent!.length).toBeLessThan(fresh.text.length);
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
  const replies = container.querySelectorAll(".agent-markdown");
  expect(replies[0].textContent).toBe(blocks[1].text);
  expect(replies[1].textContent!.length).toBeGreaterThan(0);
  expect(replies[1].textContent!.length).toBeLessThan(blocks[3].text.length);
  expect(replies[1].closest<HTMLElement>("[data-transcript-content-motion]")?.style.opacity).toBe("0");
});
