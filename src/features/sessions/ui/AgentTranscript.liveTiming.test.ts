// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appendUser, applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { setUiLanguage } from "../../../shared/i18n/language";
import { applyReducedMotion } from "../../../shared/lib/reducedMotion";
import { newSession, type Session } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let node: HTMLDivElement;
let root: Root;
let session: Session;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  session = appendUser(newSession("codex", "/project"), "Fix it");
  session.blocks[0].id = "clock";
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  applyReducedMotion("system");
});

function update(event?: HarnessEvent, clockOffsetMs?: number) {
  if (event) session = applyHarnessEvent(session, event);
  act(() => root.render(createElement(AgentTranscript, {
    blocks: session.blocks, busy: true, cwd: session.cwd, clockOffsetMs,
    pendingQuestion: !!session.pendingQuestion,
    executionState: session.executionState,
  })));
}
function tick(seconds: number) {
  act(() => vi.advanceTimersByTime(seconds * 1000));
}
function clock(kind: string, elapsed: string) {
  const footer = node.querySelector<HTMLElement>("[data-live-footer]")!;
  expect(footer.dataset.liveClock).toBe(kind);
  expect(footer.textContent).toMatch(new RegExp(`^${elapsed} · `));
  expect(footer.textContent).not.toContain("Thought for");
}
function noClock() {
  const footer = node.querySelector<HTMLElement>("[data-live-footer]")!;
  expect(footer.querySelector('[role="timer"]')).toBeNull();
  expect(footer.dataset.liveClock).toBeUndefined();
  expect(footer.textContent).not.toMatch(/^\d+[smh] · /);
}

function dots(shown: boolean) {
  // A replaced status can still be fading out ahead of the current one.
  const current = [...node.querySelectorAll<HTMLElement>("[data-live-footer] .transcript-live-status")].at(-1)!;
  expect(!!current.querySelector(".typing-dots")).toBe(shown);
  if (shown) expect(current.textContent).toBe("");
}

function verb(text: string) {
  const footer = node.querySelector<HTMLElement>("[data-live-footer]")!;
  expect(footer.textContent).toContain(text);
}

it("times thinking and replies per response round while tool verbs stay text-only", () => {
  // Before any output the footer shows only the typing dots.
  update();
  tick(8);
  noClock();
  dots(true);

  update({ type: "reasoning.delta", text: "First thought" });
  noClock();
  dots(false);
  tick(3);
  clock("thinking", "3s");
  update({ type: "reasoning.completed" });
  clock("round", "3s");

  // Tool calls show a filler verb without a clock, and a finished call keeps
  // its verb until the model's next output.
  update({ type: "tool.started", callId: "first", title: "Read file", kind: "read", status: "in_progress" });
  noClock();
  tick(2);
  noClock();
  update({ type: "tool.started", callId: "second", title: "Run tests", kind: "shell", status: "in_progress" });
  tick(2);
  noClock();
  update({ type: "tool.updated", callId: "second", status: "completed" });
  update({ type: "tool.updated", callId: "first", status: "completed" });
  tick(2);
  noClock();
  expect(node.querySelector<HTMLElement>("[data-live-footer]")!.dataset.livePhase).toBe("tool");

  update({ type: "reasoning.delta", text: "Second thought" });
  tick(2);
  clock("thinking", "2s");
  update({ type: "reasoning.completed" });
  clock("round", "2s");

  // A reply starts a new round; further tokens keep its clock in place.
  update({ type: "message.delta", text: "Here is the answer" });
  noClock();
  verb("Responding…");
  tick(2);
  clock("round", "2s");
  const timer = node.querySelector('[role="timer"]');
  const motion = timer?.getAttribute("data-motion");
  update({ type: "message.delta", text: ". More details" });
  clock("round", "2s");
  expect(node.querySelector('[role="timer"]')).toBe(timer);
  expect(timer?.getAttribute("data-motion")).toBe(motion);
  update({ type: "message.completed" });
  tick(3);
  clock("round", "5s");
  verb("Thinking…");

  update({ type: "message.delta", text: "Another response" });
  noClock();
  expect(node.querySelector(".rolling-clock-glyph")).toBeNull();
  tick(2);
  clock("round", "2s");
});

it("keeps approval waits text-only without a ticking clock", () => {
  update();
  tick(50);
  update({ type: "message.delta", text: "Please approve this command" });
  tick(5);
  update({ type: "approval.requested", requestId: 7, callId: "call", title: "Run tests", kind: "shell" });
  noClock();
  const footer = node.querySelector("[data-live-footer]")!;
  expect(footer.getAttribute("data-live-phase")).toBe("waiting");
  expect(footer.textContent).toContain("Waiting for approval");
  tick(3);
  noClock();
});

it("keeps the current time readable during a digit carry and when motion is disabled", () => {
  update({ type: "reasoning.delta", text: "Thinking through the fix" });
  tick(9);
  const timer = node.querySelector('[role="timer"]')!;
  expect(timer.getAttribute("aria-label")).toBe("9s");
  tick(1);
  expect(node.querySelector('[role="timer"]')).toBe(timer);
  expect(timer.getAttribute("aria-label")).toBe("10s");
  expect(timer.textContent).toBe("10s");
  expect(timer.getAttribute("aria-live")).toBe("off");
  act(() => applyReducedMotion("on"));
  expect(timer.querySelector(".rolling-clock-glyph")).toBeNull();
  tick(1);
  expect(timer.getAttribute("aria-label")).toBe("11s");
  expect(timer.textContent).toBe("11s");
  expect(timer.querySelector(".rolling-clock-glyph")).toBeNull();
});

it.each([-65_000, 65_000])("uses the Host clock for both live timers with %i ms skew", (offset) => {
  // A fresh turn and first reply stamped on a Host with a different wall clock.
  vi.setSystemTime(100_000 + offset);
  session = appendUser(newSession("pi", "/project"), "Hello");
  session = applyHarnessEvent(session, { type: "message.delta", text: "Hello!" });
  vi.setSystemTime(100_000);
  update(undefined, offset);
  noClock();
  tick(3);
  clock("round", "3s");
  expect(node.textContent).toContain("working… · 3s");
  expect(node.textContent).not.toContain("1m");

  // Reloading an already-running turn retains its real age rather than
  // restarting at mount or counting the clock skew as work.
  act(() => root.unmount());
  root = createRoot(node);
  tick(7);
  update(undefined, offset);
  clock("round", "10s");
  expect(node.textContent).toContain("working… · 10s");
  expect(session.blocks[0].startedAt).toBe(100_000 + offset);
});

it("shows startup and resource phases above the footer while keeping its dots until model output", () => {
  session.executionState = { runId: "run", phase: "waiting-resource", since: 95_000, reason: "integrating",
    blockers: [{ id: "native:terminal", ownerPid: 123, kind: "integrating", path: "/project" }] };
  update();
  expect(node.textContent).toContain("Waiting for workspace changes to finish…");
  expect(node.textContent).not.toContain("Thinking…");
  expect(node.querySelector("[data-live-footer]")?.getAttribute("title")).toContain("PID 123");
  dots(true);
  noClock();
  // Starting up and waiting for the model are initialization: dots stand in for the footer text.
  session.executionState = { runId: "run", phase: "starting", since: 100_000 };
  update(); expect(node.textContent).toContain("Preparing to start…");
  dots(true);
  session.executionState = { runId: "run", phase: "awaiting-response", since: 100_000, providerStartedAt: 100_000 };
  update(); expect(node.textContent).toContain("Waiting for model response…");
  tick(2);
  dots(true);
  noClock();
  expect(node.textContent).not.toContain("Thinking…");
  session.executionState = { ...session.executionState, phase: "active" };
  update({ type: "reasoning.delta", text: "Actual reasoning" });
  expect(node.textContent).toContain("Thinking");
});

it("keeps startup progress above the footer without interrupting its typing dots", async () => {
  act(() => applyReducedMotion("on"));
  session.executionState = { runId: "run", phase: "starting", since: 95_000,
    startup: { stage: "copying", completed: 1024, total: 2048, unit: "bytes" } };
  update();
  dots(true);
  noClock();
  expect(node.textContent).toContain("Copying agent to WSL…");
  expect(node.textContent).toContain("1.0 KiB / 2.0 KiB (50%)");
  const typing = node.querySelector("[data-live-footer] .typing-dots");
  expect(node.querySelector("[data-live-footer]")?.textContent).toBe("");
  expect(node.querySelector('[role="progressbar"]')).toBeNull();
  session.executionState.startup!.completed = 2048;
  update();
  expect(node.querySelector("[data-live-footer] .typing-dots")).toBe(typing);
  expect(node.textContent).toContain("100%");
  session.executionState.startup = { stage: "configuring" };
  update();
  expect(node.textContent).toContain("Configuring agent…");
  expect(node.querySelector("[data-live-footer] .typing-dots")).toBe(typing);
  session.executionState = { runId: "run", phase: "awaiting-response", since: 100_000 };
  update();
  await act(async () => {});
  const current = [...node.querySelectorAll("[data-live-footer] .transcript-live-status")].at(-1);
  expect(current?.getAttribute("role")).toBeNull();
  dots(true);
  noClock();
  expect(node.querySelector("[data-live-footer] .typing-dots")).toBe(typing);
  session.executionState = { ...session.executionState, phase: "active" };
  update({ type: "message.delta", text: "First model response" });
  await act(async () => {});
  dots(false);
  verb("Responding…");
});
