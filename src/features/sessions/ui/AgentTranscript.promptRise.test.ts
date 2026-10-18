// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { msgTransition } from "../../../shared/motion/tokens";
const { animate } = vi.hoisted(() => ({ animate: vi.fn() }));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(), animate,
}));

const appearance = vi.hoisted(() => ({
  layout: "chat" as "chat" | "full",
  anchor: true,
  // Where earlier turns sit; moving it between renders models a send's scroll.
  turnTop: 0,
}));
vi.mock("../hooks/useTranscriptLayout", () => ({
  useTranscriptLayout: () => appearance.layout,
}));
vi.mock("../hooks/useTranscriptAnchor", () => ({
  useTranscriptAnchor: () => appearance.anchor,
}));

let container: HTMLDivElement;
let root: Root;

let promptMotion: "mobile" | undefined;

const first: Block[] = [{ id: "u1", role: "user", text: "Hello" }];
const second: Block[] = [
  ...first,
  { id: "a1", role: "assistant", text: "Hi" },
  { id: "u2", role: "user", text: "Next" },
];

function render(blocks: Block[], busy = true, options: { promptMotion?: "mobile"; animateFrom?: string } = { promptMotion }) {
  act(() =>
    root.render(
      createElement(AgentTranscript, { blocks, busy, visible: true, ...options }),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  appearance.layout = "chat";
  appearance.anchor = true;
  appearance.turnTop = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("transcript-turn") && !this.querySelector("[data-prompt-anchor='u2']"))
        return { left: 0, right: 400, width: 400, top: appearance.turnTop, bottom: appearance.turnTop + 100, height: 100 } as DOMRect;
      return (
        this.dataset.promptAnchor || this.classList.contains("user-message-bubble")
          ? { left: 200, right: 400, width: 200, top: 0, bottom: 60, height: 60 }
          : { left: 0, right: 400, width: 400, top: 0, bottom: 800, height: 800 }
      ) as DOMRect;
    },
  );
  animate.mockReset();
  animate.mockImplementation((_subjects, _keyframes, options) => {
    let resolve!: () => void;
    const finished = new Promise<void>(done => { resolve = done; });
    const cancel = vi.fn(resolve);
    const complete = vi.fn(() => { options?.onComplete?.(); resolve(); });
    return { then: finished.then.bind(finished), finished, time: 0,
      finish: complete, complete, cancel, stop: cancel };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function slides() {
  return animate.mock.calls.flatMap(([subjects, keyframes, transition], index) =>
    Array.isArray(subjects) && keyframes.y ? [{ element: subjects[0] as HTMLElement, keyframes, transition, playback: animate.mock.results[index].value }] : []);
}
function risenPrompts() { return [...new Set(slides().map(({ element }) => element.closest<HTMLElement>("[data-prompt-anchor]")?.dataset.promptAnchor))]; }
async function start() { await act(async () => { await Promise.resolve(); }); }
async function finish(playback: { finish: () => void }) { await act(async () => { playback.finish(); await Promise.resolve(); }); }
function turn(id: string) { return container.querySelector<HTMLElement>(`[data-prompt-anchor="${id}"]`)!.closest<HTMLElement>(".transcript-turn")!; }
function opacityCalls() { return animate.mock.calls.filter(([, keyframes]) => keyframes.opacity); }

describe("desktop prompt entrances", () => {
  it.each([["chat", true], ["chat", false], ["full", true], ["full", false]] as const)("slides chat prompts without changing AI entrances (layout=%s, anchor=%s)", async (layout, anchor) => {
    appearance.layout = layout; appearance.anchor = anchor;
    const desktop = { promptMotion: undefined };
    render([], false, desktop); render(first, true, desktop); await start();
    render([...first, { id: "a1", role: "assistant", text: "Hi", streaming: true }], true, desktop);
    render(second, true, desktop); await start();
    if (layout === "chat") { expect(slides().length).toBeGreaterThan(0); expect(turn("u2").dataset.promptRise).toBe("rising"); }
    else { expect(animate).not.toHaveBeenCalled(); expect(container.querySelector("[data-prompt-rise]")).toBeNull(); }
    expect(container.querySelector("[data-transcript-content-motion]")).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-prompt-anchor="u2"]')!.style.visibility).toBe("");
    expect(container.querySelector(".agent-markdown")).not.toBeNull();
  });
});
describe.each([undefined, "mobile"] as const)("shared prompt rise (motion=%s)", motion => {
  beforeEach(() => { promptMotion = motion; });
  it("slides the first prompt up from the dock and settles it from a pending tint", async () => {
    render([], false); render(first); await start();
    expect(risenPrompts()).toEqual(["u1"]);
    expect(slides()[0].keyframes).toEqual({ y: [732, 0] });
    expect(slides()[0].transition).toEqual(msgTransition);
    expect(container.querySelector('[data-prompt-anchor="u1"]')?.getAttribute("data-prompt-motion")).toBe("smooth");
    expect(opacityCalls()[0][1]).toEqual({ opacity: [0.5, 1] });
    for (const [, keyframes] of animate.mock.calls) {
      expect(keyframes).not.toHaveProperty("width"); expect(keyframes).not.toHaveProperty("scale");
    }
  });
  it("holds the rest of the turn until the animation actually finishes", async () => {
    render([], false); render(first); const current = turn("u1");
    expect(current.dataset.promptRise).toBe("rising"); await start();
    act(() => vi.advanceTimersByTime(2000)); expect(current.dataset.promptRise).toBe("rising");
    await finish(slides()[0].playback); expect(current.dataset.promptRise).toBe("revealing");
    await finish(animate.mock.results.at(-1)!.value); expect(current.dataset.promptRise).toBeUndefined();
  });
  it("rises each newly sent prompt", async () => {
    render(first, false); render(second); await start(); expect(risenPrompts()).toEqual(["u2"]);
  });
  it.each([true, false])("scrolls the earlier turn and the new prompt together (anchor=%s)", async anchor => {
    appearance.anchor = anchor; appearance.turnTop = 300; render(first, false); render(second);
    appearance.turnTop = 100; await start();
    const bubble = container.querySelector<HTMLElement>('[data-prompt-anchor="u2"] .user-message-bubble')!;
    const slide = slides().find(value => value.element === bubble)!;
    const previous = slides().find(value => value.element === turn("u1"))!;
    expect(slide.keyframes).toEqual({ y: [200, 0] });
    expect(previous.keyframes).toEqual(slide.keyframes); expect(previous.transition).toEqual(slide.transition);
  });
  it("keeps a sending prompt tinted and hands its slide to the recorded copy", async () => {
    const sending: Block[] = [...first, { id: "a1", role: "assistant", text: "Hi" }, { id: "sending:1", role: "user", text: "Next", sending: true }];
    render(first, false); render(sending, false); await start();
    const pending = container.querySelector<HTMLElement>('[data-prompt-anchor="sending:1"]')!;
    expect(pending.dataset.sending).toBe("true"); expect(risenPrompts()).toEqual(["sending:1"]);
    expect(opacityCalls()).toHaveLength(0); const original = slides()[0]; const running = slides().map(value => value.playback);
    render(second);
    const bubble = container.querySelector<HTMLElement>('[data-prompt-anchor="u2"] .user-message-bubble')!;
    const handed = slides().find(value => value.element === bubble)!;
    expect(handed.keyframes).toEqual(original.keyframes); expect(handed.transition).toEqual(original.transition);
    expect(handed.playback.time).toBe(original.playback.time);
    for (const playback of running) expect(playback.complete).not.toHaveBeenCalled();
    expect(bubble.closest<HTMLElement>("[data-prompt-anchor]")!.dataset.sending).toBeUndefined();
    await finish(original.playback); expect(turn("u2").dataset.promptRise).toBe("revealing");
  });
  it("lifts a recorded copy to full strength once the slide has landed", async () => {
    render(first, false); render([...first, { id: "sending:1", role: "user", text: "Next", sending: true }], false); await start();
    await finish(slides()[0].playback); const calls = opacityCalls().length;
    render([...first, { id: "u2", role: "user", text: "Next" }]);
    expect(opacityCalls().slice(calls).map(([, keyframes]) => keyframes)).toEqual([{ opacity: [0.5, 1] }]);
  });
  it("lifts a prompt the Host records under the same id where it is", async () => {
    render(first, false); render([...first, { id: "u2", role: "user", text: "Next", sending: true }], false); await start();
    const row = container.querySelector<HTMLElement>('[data-prompt-anchor="u2"]')!; const calls = opacityCalls().length;
    render([...first, { id: "u2", role: "user", text: "Next" }]);
    expect(container.querySelector('[data-prompt-anchor="u2"]')).toBe(row); expect(row.dataset.sending).toBeUndefined();
    expect(opacityCalls().slice(calls).map(([, keyframes]) => keyframes)).toEqual([{ opacity: [0.5, 1] }]);
  });
  it("drops a withdrawn sending prompt without replaying the previous one", async () => {
    render(first, false); render([...first, { id: "sending:1", role: "user", text: "Next", sending: true }], false); await start();
    const calls = animate.mock.calls.length; const running = slides().map(value => value.playback);
    render(first, false); await start(); expect(animate.mock.calls).toHaveLength(calls);
    for (const playback of running) expect(playback.complete).toHaveBeenCalledTimes(1);
  });
  it.each([[true, "Caption"], [false, "Caption"], [true, ""], [false, ""]] as const)("slides sent images with their caption and supports image-only sends (anchor=%s, text=%s)", async (anchor, text) => {
    appearance.anchor = anchor; render(first, false);
    render([...first, { id: "u2", role: "user", text, attachments: ["one", "two"].map(id => ({ id, name: `${id}.png`, kind: "image", mimeType: "image/png", data: "aGVsbG8=", size: 5 })) }]);
    const row = container.querySelector<HTMLElement>('[data-prompt-anchor="u2"]')!;
    const bubble = row.querySelector<HTMLElement>(".user-message-bubble")!; const media = row.querySelector<HTMLElement>(".user-message-media")!;
    vi.spyOn(bubble, "getBoundingClientRect").mockReturnValue(text ? { left: 200, right: 400, width: 200, top: 270, bottom: 330, height: 60 } as DOMRect : { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 } as DOMRect);
    vi.spyOn(media, "getBoundingClientRect").mockReturnValue({ left: 120, right: 400, width: 280, top: 100, bottom: 260, height: 160 } as DOMRect); await start();
    const slide = slides().find(value => value.element === media)!;
    expect(bubble.hidden).toBe(!text); expect(slide.keyframes).toEqual({ y: [text ? 462 : 532, 0] });
    expect(slide.keyframes).toEqual(slides()[0].keyframes); expect(slide.transition).toEqual(slides()[0].transition);
    expect(slide.playback.time).toBe(slides()[0].playback.time);
    await finish(slides()[0].playback); expect(turn("u2").dataset.promptRise).toBe("revealing"); expect(media.querySelectorAll("img")).toHaveLength(2);
  });
  it.each([{ blocks: first }, { blocks: second }])("does not replay an existing running conversation on mount ($blocks.length blocks)", async ({ blocks }) => {
    render(blocks); await start(); expect(animate).not.toHaveBeenCalled();
  });
  it("does not replay the latest prompt when StrictMode replays mount effects", async () => {
    act(() => root.render(createElement(StrictMode, null, createElement(AgentTranscript, { blocks: second, busy: false, visible: true, promptMotion }))));
    await start(); expect(animate).not.toHaveBeenCalled(); expect(container.querySelector("[data-prompt-rise]")).toBeNull();
  });
  it("does not introduce prompts received while another session was visible", async () => {
    render(first, false); act(() => root.render(createElement(AgentTranscript, { blocks: first, visible: false })));
    act(() => root.render(createElement(AgentTranscript, { blocks: second, busy: true, visible: false })));
    render(second); await start(); expect(animate).not.toHaveBeenCalled(); expect(container.querySelector("[data-prompt-rise]")).toBeNull();
    render([...second, { id: "u3", role: "user", text: "New send" }]); await start(); expect(risenPrompts()).toEqual(["u3"]);
  });
  it("introduces an explicitly marked submission when the transcript first mounts", async () => {
    render(second, true, { promptMotion, animateFrom: "u2" }); await start(); expect(risenPrompts()).toEqual(["u2"]);
  });
  it("stays still in the full-width layout", async () => {
    appearance.layout = "full"; render(first); render(second); await start(); expect(animate).not.toHaveBeenCalled();
  });
  it("starts sends above the dock after layout, including a reply completed before sync", async () => {
    render(second, false, { promptMotion, animateFrom: "u2" }); const row = container.querySelector<HTMLElement>('[data-prompt-anchor="u2"]')!;
    container.querySelector<HTMLElement>(".agent-transcript")!.style.paddingBottom = "128px";
    expect(row.style.visibility).toBe("hidden"); expect(animate).not.toHaveBeenCalled(); await start();
    expect(row.style.visibility).toBe(""); expect(risenPrompts()).toEqual(["u2"]);
    expect(slides()[0].element.className).toContain("user-message-bubble"); expect(slides()[0].keyframes).toEqual({ y: [604, 0] });
    await finish(slides()[0].playback); expect(turn("u2").dataset.promptRise).toBe("revealing");
    await finish(animate.mock.results.at(-1)!.value); expect(turn("u2").dataset.promptRise).toBeUndefined();
    const calls = animate.mock.calls.length; render(second, false, { promptMotion, animateFrom: "u2" }); expect(animate).toHaveBeenCalledTimes(calls);
  });
  it("lands the previous slide on the next send without revealing the old turn", async () => {
    render(first, false); render(second); await start(); const oldTurn = turn("u2"); const previous = slides().map(value => value.playback);
    render([...second, { id: "u3", role: "user", text: "Again" }]); await start(); expect(oldTurn.dataset.promptRise).toBeUndefined();
    for (const playback of previous) expect(playback.complete).toHaveBeenCalledTimes(1); expect(turn("u3").dataset.promptRise).toBe("rising");
  });
  it("lands a slide when hidden and does not replay it when shown", async () => {
    render([], false); render(first); await start(); const slide = slides()[0].playback;
    await act(async () => root.render(createElement(AgentTranscript, { blocks: first, busy: true, visible: false })));
    expect(slide.complete).toHaveBeenCalledTimes(1); expect(turn("u1").dataset.promptRise).toBeUndefined();
    const calls = animate.mock.calls.length; render(first); await start(); expect(animate).toHaveBeenCalledTimes(calls);
  });
  it("cancels a pending entrance when the transcript unmounts", async () => {
    render([], false); render(first); const row = container.querySelector<HTMLElement>('[data-prompt-anchor="u1"]')!;
    act(() => root.unmount()); await start(); expect(animate).not.toHaveBeenCalled(); expect(row.style.visibility).toBe("");
  });
  it.each([true, false])("keeps history and reduced-motion sends still (anchor=%s)", async anchor => {
    appearance.anchor = anchor; render(second, false); await start(); expect(animate).not.toHaveBeenCalled();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); render([...second, { id: "u3", role: "user", text: "Again" }]); await start();
    expect(animate).not.toHaveBeenCalled(); expect(container.querySelector<HTMLElement>('[data-prompt-anchor="u3"]')!.style.visibility).toBe("");
  });
});
