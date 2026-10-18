import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MobileTranscript } from "./MobileTranscript";
import type {
  HostCommand,
  HostSession,
} from "../features/connections/model/protocol";
import type { Block } from "../features/sessions/model/session";
import { saveTranscriptAnchor } from "../features/settings/model/appearance";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => {
  startMotionClock();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  stopMotionClock();
  vi.restoreAllMocks();
});
function render(
  options: { runId?: string; disabled?: boolean; block?: object; blocks?: Block[];
    onCommand?: (command: HostCommand) => Promise<boolean> } = {},
) {
  const commands: HostCommand[] = [];
  const node = document.createElement("div");
  node.className = "mobile-app";
  document.body.append(node);
  const snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status: "running",
    runId: options.runId,
    updatedAt: 1,
    session: {
      id: "session",
      title: "Test",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: options.blocks ?? [
        {
          id: "tool",
          role: "tool",
          text: "Run npm test?",
          tool: { title: "Run npm test?" },
          approval: { requestId: 7 },
          ...options.block,
        },
      ],
    },
  };
  let props: ComponentProps<typeof MobileTranscript> = {
    snapshot,
    disabled: options.disabled ?? false,
    onCommand: options.onCommand ?? ((command) => { commands.push(command); }),
  };
  root = createRoot(node);
  const update = (next: Partial<typeof props>) => {
    props = { ...props, ...next };
    act(() => root!.render(createElement(MobileTranscript, props)));
  };
  update({});
  return { node, commands, snapshot, update };
}

describe("mobile prompt anchoring", () => {
  afterEach(() => localStorage.removeItem("monocode.transcriptAnchor"));

  it.each([false, true])("loads the saved %s preference and applies changes to current and new prompts", (enabled) => {
    saveTranscriptAnchor(enabled);
    const blocks: Block[] = [{ id: "user", role: "user", text: "Work" }];
    const { node, snapshot, update } = render({ blocks });
    const turn = node.querySelector<HTMLElement>(".transcript-turn")!;
    expect(turn.classList.contains("transcript-turn-anchor")).toBe(enabled);

    act(() => saveTranscriptAnchor(!enabled));
    expect(node.querySelector(".transcript-turn")).toBe(turn);
    expect(turn.classList.contains("transcript-turn-anchor")).toBe(!enabled);

    update({ animateFrom: "next", snapshot: {
      ...snapshot,
      session: { ...snapshot.session, blocks: [
        ...blocks,
        { id: "reply", role: "assistant", text: "Done" },
        { id: "next", role: "user", text: "Continue" },
      ] },
    } });
    expect(node.querySelector(".transcript-turn-live")!
      .classList.contains("transcript-turn-anchor")).toBe(!enabled);
    expect(node.querySelector(".transcript-turn-live")?.getAttribute("data-prompt-rise")).toBe("rising");
  });
});

describe("mobile transcript behind the drawer", () => {
  it("keeps live work unfolded while covered", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Work" },
      { id: "think", role: "thinking", text: "Planning the change" },
      { id: "tool", role: "tool", text: "npm test", tool: { title: "Run npm test" } },
    ];
    const { node, update } = render({ blocks });
    const live = () => [...node.querySelectorAll(".transcript-turn-live *")]
      .map((element) => `${element.className}|${element.getAttribute("data-fold-state") ?? ""}`)
      .join("\n");
    const before = live();
    expect(before).not.toBe("");
    update({ active: false });
    expect(live()).toBe(before);
    update({ active: true });
    expect(live()).toBe(before);
  });
});

describe("mobile approval interaction", () => {
  it("renders approvals attached to real Host tool blocks and sends the active run identity", () => {
    const { node, commands } = render({ runId: "active-run" });
    const allow = [...node.querySelectorAll("button")].find(
      (button) => button.textContent === "Allow",
    )!;
    expect(allow).toBeDefined();
    act(() => allow.click());
    expect(commands[0]).toMatchObject({
      type: "approve",
      sessionId: "session",
      runId: "active-run",
      requestId: 7,
      decision: "allow",
    });
  });
  it("disables approval after reconnect without a current run or while another command is pending", () => {
    let result = render();
    expect(
      [...result.node.querySelectorAll("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    act(() => root!.unmount());
    result = render({ runId: "active-run", disabled: true });
    expect(
      [...result.node.querySelectorAll("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });
  it("shows resolved approval state without actionable buttons", () => {
    const { node } = render({
      runId: "active-run",
      block: { approval: { requestId: 7, decided: "allow" } },
    });
    expect(node.querySelector(".agent-transcript")).not.toBeNull();
    expect(
      [...node.querySelectorAll("button")].some((button) =>
        ["Allow", "Deny"].includes(button.textContent || ""),
      ),
    ).toBe(false);
  });
});

describe("mobile jump interaction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.useRealTimers();
  });
  it("consumes pointer, mouse and click events and keeps composer focus", async () => {
    const { node } = render({ runId: "active-run" });
    const parent = document.createElement("div");
    node.replaceWith(parent);
    parent.append(node);
    const scroller = node.querySelector<HTMLDivElement>(".agent-transcript")!;
    let top = 0;
    Object.defineProperties(scroller, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 1000 },
      scrollTop: {
        get: () => top,
        set: (value: number) => { top = Math.max(0, Math.min(value, 600)); },
      },
    });
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scroller.querySelector<HTMLElement>("[data-transcript-end]")!
      .getBoundingClientRect = () => ({ top: 1000 - top }) as DOMRect;
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 })));
    const button = node.querySelector<HTMLButtonElement>(".mobile-jump")!;
    expect(button).not.toBeNull();
    expect(button.dataset.foldState).toBe("opening");
    expect(button.disabled).toBe(false);
    const composer = document.createElement("textarea");
    node.append(composer);
    composer.focus();
    const bubbled = vi.fn();
    for (const type of ["pointerdown", "mousedown", "click"])
      parent.addEventListener(type, bubbled);
    for (const type of ["pointerdown", "mousedown", "click"]) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      act(() => button.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
    expect(node.querySelector(".mobile-jump")).toBe(button);
    expect(button.dataset.foldState).toBe("closing");
    expect(button.disabled).toBe(true);
    expect(button.inert).toBe(true);
    expect(button.getAttribute("aria-hidden")).toBe("true");
    await advanceMotionTimers(100);
    // Scroll away again during the fade: reuse the same button and cancel closing.
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 })));
    expect(node.querySelector(".mobile-jump")).toBe(button);
    expect(button.dataset.foldState).toBe("opening");
    expect(button.disabled).toBe(false);
    await advanceMotionTimers(600);
    expect(button.dataset.foldState).toBe("open");
    act(() => button.click());
    await advanceMotionTimers(100);
    expect(button.dataset.foldState).toBe("closing");
    await advanceMotionTimers(200);
    expect(button.dataset.foldState).toBe("closed");
  });
});

describe("mobile message streaming", () => {
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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const text = "这段中文将逐字显示，不会等待整句话完成之后再一起出现。";
  function reply(animate: boolean) {
    const node = document.createElement("div");
    document.body.append(node);
    const snapshot: HostSession = {
      projectId: "project",
      revision: 1,
      status: "idle",
      updatedAt: 1,
      session: {
        id: "fast-session",
        title: "Test",
        cwd: "/project",
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
        blocks: [
          { id: "user", role: "user", text: "Reply in Chinese" },
          { id: "reply", role: "assistant", text },
        ],
      },
    };
    act(() => {
      root = createRoot(node);
      root.render(
        createElement(MobileTranscript, {
          snapshot,
          disabled: false,
          onCommand: () => {},
          animateFrom: animate ? "user" : undefined,
        }),
      );
    });
    return node;
  }
  it("shows a submitted reply immediately when it finished before the first sync", () => {
    const node = reply(true);
    expect(node.querySelector("[data-word-fade]")).toBeNull();
    expect(node.querySelector(".agent-markdown")?.textContent).toBe(text);
  });
  it("shows saved replies immediately without replaying the typewriter", () => {
    const node = reply(false);
    expect(node.querySelector(".agent-markdown")?.textContent).toBe(text);
  });
});

describe("mobile question history", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const dialog = () => document.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([inert]) [role="dialog"]')!;
  const question: Block = {
    id: "saved-question", role: "system", text: "Which source?",
    question: { requestId: 3, historyId: "saved-question", allowLateReply: true, decision: "skipped",
      questions: [{ id: "q", prompt: "Which source?", allowCustom: false, multiSelect: false,
        options: [{ id: "local", label: "Local" }, { id: "remote", label: "Remote" }] }] },
  };
  it.each([undefined, "new-run"])("answers a missed question from the transcript with active run %s", async runId => {
    const { node, commands } = render({ runId, blocks: [
      { id: "user", role: "user", text: "Work" }, question,
      { id: "done", role: "assistant", text: "Work continued" },
    ] });
    const history = node.querySelector('[data-question-history="saved-question"]')!;
    expect(history).not.toBeNull();
    expect(history.textContent).toContain("Answer question");
    act(() => history.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
    expect(history.querySelector("[data-question-form]")).toBeNull();
    expect(dialog().closest(".mobile-app")).toBe(node);
    expect(dialog().closest(".mobile-desktop-transcript")).toBeNull();
    const option = [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Local")!;
    act(() => option.click());
    await advanceMotionTimers(400);
    await act(async () => dialog().querySelector<HTMLButtonElement>('[data-question-submit]')!.click());
    expect(commands).toEqual([expect.objectContaining({
      type: "send", sessionId: "session", text: "Which source?\nLocal", followUpBehavior: "steer",
      questionAnswer: { blockId: "saved-question", reply: { kind: "answered", answers: { q: ["local"] } } },
    })]);
    expect(commands[0]).not.toHaveProperty("runId");
    expect(commands[0]).not.toHaveProperty("requestId");
    expect(dialog()).toBeNull();
    expect(node.querySelector('.mobile-sheet-backdrop[data-fold-state="closing"][inert]')).not.toBeNull();
    await advanceMotionTimers(600);
    expect(node.querySelector('[role="dialog"]')).toBeNull();
  });

  it("folds the pending question panel and reopens it from its transcript card", () => {
    const onQuestionOpenChange = vi.fn();
    const prompt = { ...question.question!, decision: undefined, historyId: "saved-question" };
    const { node, snapshot, update } = render({ runId: "run", blocks: [
      { id: "user", role: "user", text: "Work" }, { ...question, question: prompt },
    ] });
    snapshot.session.pendingQuestion = prompt;
    update({ snapshot: { ...snapshot }, onQuestionOpenChange });
    const panel = node.querySelector<HTMLElement>(".mobile-shared-question-dock")!;
    expect(panel.dataset.open).toBe("true");
    act(() => node.querySelector<HTMLButtonElement>("[data-question-collapse]")!.click());
    expect(onQuestionOpenChange).toHaveBeenLastCalledWith(false);
    update({ questionOpen: false });
    // Folded, not unmounted: an answer in progress survives.
    expect(panel.dataset.open).toBe("false");
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.querySelector("[data-question-form], [data-question-card]")).not.toBeNull();
    const card = node.querySelector<HTMLButtonElement>('[data-question-history="saved-question"] > button')!;
    expect(card.textContent).toContain("Answer question");
    act(() => card.click());
    expect(onQuestionOpenChange).toHaveBeenLastCalledWith(true);
    expect(node.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows saved answers after reopening and keeps blocking questions read-only", () => {
    const answered: Block = { ...question, question: { ...question.question!, decision: "answered",
      reply: { kind: "answered", answers: { q: ["remote"] } } } };
    const { node, commands } = render({ blocks: [
      { id: "user", role: "user", text: "Work" }, answered,
      { ...question, id: "blocking", question: { ...question.question!, allowLateReply: false } },
    ] });
    for (const button of node.querySelectorAll<HTMLButtonElement>('[data-question-history] > button'))
      act(() => button.click());
    const history = node.querySelector('[data-question-history="saved-question"]')!;
    // Answered questions read as a flat question/answer list on phones.
    expect(history.textContent).toBe("Which source?Remote");
    expect(history.querySelector("button")).toBeNull();
    expect(node.querySelector("[data-question-form]")).toBeNull();
    expect(commands).toEqual([]);
  });

  it("keeps an unsuccessful late answer open for retry", async () => {
    const onCommand = vi.fn(async (_command: HostCommand) => false);
    const { node } = render({ blocks: [question], onCommand });
    const history = node.querySelector('[data-question-history="saved-question"]')!;
    act(() => history.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
    act(() => [...dialog().querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent === "Local")!.click());
    const submit = dialog().querySelector<HTMLButtonElement>('[data-question-submit]')!;
    await act(async () => submit.click());
    expect(dialog()).not.toBeNull();
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[1][0]).toMatchObject({ type: "send", text: "Which source?\nLocal",
      questionAnswer: { blockId: "saved-question", reply: { kind: "answered", answers: { q: ["local"] } } } });
  });

  it("retains answers during a closing reversal and skips without sending a reply", async () => {
    const { node, commands } = render({ blocks: [question] });
    const trigger = node.querySelector<HTMLButtonElement>('[data-question-history] > button')!;
    act(() => trigger.click());
    const sheet = dialog();
    const option = sheet.querySelector<HTMLButtonElement>('[data-question-option]')!;
    act(() => option.click());
    act(() => sheet.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    expect(sheet.closest("[inert]")).not.toBeNull();
    act(() => trigger.click());
    expect(dialog()).toBe(sheet);
    expect(option.getAttribute("aria-pressed")).toBe("true");
    act(() => sheet.querySelector<HTMLButtonElement>('[data-question-secondary]')!.click());
    await advanceMotionTimers(600);
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(commands).toEqual([]);
  });

  it("disables answers while disconnected and removes the sheet when the transcript is hidden", () => {
    const { node, commands, update } = render({ blocks: [question], disabled: true });
    act(() => node.querySelector<HTMLButtonElement>('[data-question-history] > button')!.click());
    expect(dialog().querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    update({ disabled: false });
    expect(dialog().querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false);
    update({ active: false });
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    update({ active: true });
    expect(dialog()).toBeNull();
    expect(commands).toEqual([]);
  });

  it("closes if another client answers the saved question", async () => {
    const { node, snapshot, update } = render({ blocks: [question] });
    act(() => node.querySelector<HTMLButtonElement>('[data-question-history] > button')!.click());
    const answered: Block = { ...question, question: { ...question.question!, decision: "answered",
      reply: { kind: "answered", answers: { q: ["remote"] } } } };
    update({ snapshot: { ...snapshot, session: { ...snapshot.session, blocks: [answered] } } });
    expect(dialog()).toBeNull();
    await advanceMotionTimers(600);
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(node.querySelector('[data-question-history]')!.textContent).toContain("Remote");
  });
});
