// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { applyReducedMotion } from "../../../shared/lib/reducedMotion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  startMotionClock();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  vi.restoreAllMocks();
  applyReducedMotion("system");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function tool(id: string): Block {
  return {
    id,
    role: "tool",
    text: `Run ${id}`,
    tool: { kind: "shell", status: "in_progress" },
  };
}

function render(blocks: Block[], busy = true, visible = true) {
  act(() =>
    root.render(createElement(AgentTranscript, { blocks, busy, visible })),
  );
}

function advanceText(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 25)
    act(() => vi.advanceTimersByTime(25));
}

it("paces received chunks without moving streaming prose", () => {
  const animate = vi.spyOn(Element.prototype, "animate");
  const entrances = () => animate.mock.contexts.filter(node =>
    node.hasAttribute("data-transcript-content-motion"));
  const user: Block = { id: "user", role: "user", text: "Review" };
  const history: Block[] = [
    { id: "previous-user", role: "user", text: "Hello" },
    { id: "previous-reply", role: "assistant", text: "已有回复。" },
    user,
  ];
  const text = "新回复原地逐字显示，不播放从下往上的入场动画。".repeat(8);
  const reply = (text: string, streaming = true): Block => ({
    id: "reply", role: "assistant", text, streaming,
  });
  const received = () => container.querySelectorAll(".agent-markdown")[1]!;
  render(history);
  expect(container.querySelector(".agent-markdown")!.textContent).toBe("已有回复。");
  expect(entrances()).toHaveLength(0);

  render([...history, reply(text)]);
  expect(entrances()).toHaveLength(0);
  expect(received().closest("[data-transcript-content-motion]")).toBeNull();
  expect(received().textContent!.length).toBeGreaterThan(0);
  expect(received().textContent!.length).toBeLessThan(text.length);

  render([...history, reply(text + text, false)], false);
  expect(received().textContent!.length).toBeLessThan((text + text).length);
  advanceText(3000);
  expect(received().textContent).toBe(text + text);
  expect(received().closest("[data-transcript-content-motion]")).toBeNull();
  expect(entrances()).toHaveLength(0);
  expect(container.querySelector("[data-word-fade]")).toBeNull();
});

it("shows new desktop output immediately without sliding when motion is reduced", () => {
  applyReducedMotion("on");
  const animate = vi.spyOn(Element.prototype, "animate");
  const user: Block = { id: "user", role: "user", text: "Review" };
  render([user]);
  render([user, { id: "reply", role: "assistant", text: "收到回复。", streaming: true }]);
  expect(container.querySelector(".agent-markdown")!.textContent).toBe("收到回复。");
  expect(animate.mock.contexts.filter(node =>
    node.hasAttribute("data-transcript-content-motion"))).toHaveLength(0);
});

it("flushes background output and resumes pacing fresh output", () => {
  const animate = vi.spyOn(Element.prototype, "animate");
  const entrances = () => animate.mock.contexts.filter(node =>
    node.hasAttribute("data-transcript-content-motion")).length;
  const user: Block = { id: "user", role: "user", text: "Review" };
  const reply = (text: string): Block => ({ id: "reply", role: "assistant", text, streaming: true });
  const text = "后台已经收到的回复应该直接显示。".repeat(8);
  render([user, reply("")]);
  render([user, reply(text)]);
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelector(".agent-markdown")!.textContent!.length).toBeLessThan(text.length);

  render([user, reply(text)], true, false);
  expect(container.querySelector(".agent-markdown")!.textContent).toBe(text);
  const background = text + text;
  render([user, reply(background)], true, false);
  const next: Block = { id: "next", role: "assistant", text: "后台新回复。" };
  const beforeReturn = entrances();
  render([user, reply(background), next]);
  expect([...container.querySelectorAll(".agent-markdown")].map(node => node.textContent))
    .toEqual([background, next.text]);
  expect(entrances()).toBe(beforeReturn);

  render([user, reply(background + text), next]);
  expect(container.querySelector(".agent-markdown")!.textContent).toBe(background);
  advanceText(2000);
  expect(container.querySelector(".agent-markdown")!.textContent).toBe(background + text);
});

it("keeps live work open across a switch and skips background tool entrances", () => {
  const head: Block[] = [
    { id: "user", role: "user", text: "Review" },
    { id: "intro", role: "assistant", text: "Checking." },
    tool("first"),
  ];
  render(head);
  render([...head, tool("second"), tool("third")]);
  expect(stages()).toEqual(["settled", "entering", "waiting"]);
  render([...head, tool("second"), tool("third")], true, false);
  expect(container.querySelector(".zen-phase-body")!.getAttribute("data-open")).toBe("true");
  expect(stages()).toEqual(["settled", "settled", "settled"]);
  act(() => vi.advanceTimersByTime(1000));
  render([...head, tool("second"), tool("third"), tool("fourth")]);
  expect(stages()).toEqual(["settled", "settled", "settled", "settled"]);
  expect(container.querySelector(".zen-phase-body .zen-fold-item")!.getAttribute("data-fold-state")).toBe("open");
  render([...head, tool("second"), tool("third"), tool("fourth"), tool("fifth")]);
  expect(stages()).toEqual(["settled", "settled", "settled", "settled", "entering"]);
});

function stages() {
  return [...container.querySelectorAll(".zen-phase-step")].map((step) =>
    step.hasAttribute("data-waiting")
      ? "waiting"
      : step.hasAttribute("data-entering")
        ? "entering"
        : "settled",
  );
}

it("paces a burst of tool calls so each enters after the one before it", async () => {
  const head: Block[] = [
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    tool("first"),
  ];
  render(head);
  render([...head, tool("second"), tool("third"), tool("fourth")]);

  // What was on screen when the group mounted is history; the burst queues.
  expect(stages()).toEqual(["settled", "entering", "waiting", "waiting"]);

  // Later renders must not cut the queue short.
  render([...head, tool("second"), tool("third"), tool("fourth")]);
  expect(stages()).toEqual(["settled", "entering", "waiting", "waiting"]);

  for (let frame = 0; frame < 60 && stages()[2] === "waiting"; frame++)
    await act(async () => { await finishMotion(1); });
  expect(stages()[2]).not.toBe("waiting");
  expect(stages().at(-1)).toBe("waiting");
  for (let frame = 0; frame < 120 && stages().some(stage => stage !== "settled"); frame++)
    await act(async () => { await finishMotion(1); });
  expect(stages()).toEqual(["settled", "settled", "settled", "settled"]);
});

it("keeps a closing phase inert until motion ends and supports rapid reopening", async () => {
  render([
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    tool("first"),
    tool("second"),
  ]);
  const body = container.querySelector<HTMLElement>(".zen-phase-body")!;
  const toggle = body.previousElementSibling as HTMLButtonElement;
  const content = body.querySelector<HTMLElement>(".zen-fold-item")!;
  const steps = [...body.querySelectorAll(".zen-phase-step")];
  expect(steps).toHaveLength(2);

  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(content.dataset.foldState).toBe("closing");
  expect(content.inert).toBe(true);
  expect(content.getAttribute("aria-hidden")).toBe("true");
  expect([...body.querySelectorAll(".zen-phase-step")]).toEqual(steps);

  act(() => vi.advanceTimersByTime(200));
  act(() => toggle.click());
  // Passing the original close deadline must not remove reopened content.
  act(() => vi.advanceTimersByTime(150));
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(content.dataset.foldState).toBe("opening");
  expect(content.inert).toBe(false);
  expect(content.hasAttribute("aria-hidden")).toBe(false);
  expect(body.querySelector(".zen-fold-item")).toBe(content);
  expect([...body.querySelectorAll(".zen-phase-step")]).toEqual(steps);

  act(() => toggle.click());
  expect(content.dataset.foldState).toBe("closing");
  expect(body.contains(steps[0])).toBe(true);
  await act(async () => { await finishMotion(); });
  expect(body.querySelector(".zen-fold-item")).toBeNull();
  expect(body.querySelector(".zen-phase-step")).toBeNull();
});

it("paces Chinese chunks and waits for the visible tail before showing response actions", () => {
  const user: Block = {
    id: "user",
    role: "user",
    text: "Reply in Chinese",
    durationMs: 1000,
  };
  const actions = () => container.querySelector('[aria-label="Copy response"]');
  const text =
    "手机端和桌面端现在都会逐字展示中文输出，已经显示的文字不会随着后续消息重新播放。";
  render([user, { id: "reply", role: "assistant", text: "", streaming: true }]);
  render([user, { id: "reply", role: "assistant", text, streaming: true }]);
  expect(container.querySelector(".agent-markdown")?.textContent!.length).toBeLessThan(text.length);
  expect(actions()).toBeNull();
  render(
    [user, { id: "reply", role: "assistant", text, streaming: false }],
    false,
  );
  expect(container.querySelector(".agent-markdown")?.textContent!.length).toBeLessThan(text.length);
  expect(actions()).toBeNull();
  advanceText(1000);
  expect(container.querySelector(".agent-markdown")?.textContent).toBe(text);
  expect(actions()).not.toBeNull();
  render(
    [user, { id: "reply", role: "assistant", text, streaming: true }],
    false,
  );
  expect(actions()).toBeNull();
  render(
    [user, { id: "reply", role: "assistant", text, streaming: false }],
    false,
  );
  expect(actions()).not.toBeNull();
});

it("shows all replies received in the same batch immediately", () => {
  const user: Block = { id: "user", role: "user", text: "Review" };
  const long = "这是一段较长的回复，需要先显示完毕。".repeat(20);
  render([user]);
  render([
    user,
    { id: "first", role: "assistant", text: long },
    { id: "second", role: "assistant", text: "完成" },
  ]);
  const replies = () =>
    [...container.querySelectorAll(".agent-markdown")].map(
      (node) => node.textContent,
    );
  expect(replies()).toEqual([long, "完成"]);
});

it("keeps the later reply when the earlier message leaves the transcript", () => {
  const user: Block = { id: "user", role: "user", text: "Review" };
  const second: Block = {
    id: "second",
    role: "assistant",
    text: "后面的消息现在可以继续显示。",
  };
  render([user]);
  render([
    user,
    { id: "first", role: "assistant", text: "很长的回复。".repeat(100) },
    second,
  ]);
  act(() => vi.advanceTimersByTime(100));
  expect(container.querySelectorAll(".agent-markdown")[1].textContent).toBe(second.text);
  render([user, second]);
  act(() => vi.advanceTimersByTime(2000));
  expect(container.querySelector(".agent-markdown")?.textContent).toBe(
    second.text,
  );
});

it("closes work the answer folds where it stood instead of dropping it in one frame", async () => {
  const work: Block[] = [
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    { ...tool("first"), tool: { kind: "shell", status: "completed" } },
  ];
  render(work);
  act(() => vi.advanceTimersByTime(2_000));
  expect(container.textContent).toContain("Run first");

  render([...work, { id: "answer", role: "assistant", text: "Here is the answer." }]);
  const closing = () =>
    [...container.querySelectorAll('.zen-fold-item')].filter(
      (item) => item.textContent?.includes("Run first"),
    );
  // Still on screen in the frame the fold lands, then closing in place.
  expect(closing().length).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(20));
  expect(closing().some((item) => item.getAttribute("data-fold-state") === "closing")).toBe(true);
  await act(async () => { await finishMotion(); });
  expect(closing()).toHaveLength(0);
});
