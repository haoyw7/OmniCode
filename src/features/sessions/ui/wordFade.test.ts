// @vitest-environment happy-dom
import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { applyReducedMotion } from "../../../shared/lib/reducedMotion";
import {
  revealBoundary,
  usePacedText,
  WordFadeManager,
  type TextRevealOptions,
} from "./wordFade";

let host: HTMLDivElement;
let root: Root;
let samples: { time: number; length: number }[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  samples = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  applyReducedMotion("system");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function Probe({
  text,
  streaming = true,
  options,
}: {
  text: string;
  streaming?: boolean;
  options?: TextRevealOptions;
}) {
  const paced = usePacedText(text, streaming, options);
  useLayoutEffect(() => {
    if (samples.at(-1)?.length !== paced.text.length)
      samples.push({ time: performance.now(), length: paced.text.length });
  }, [paced.text]);
  return createElement(
    "span",
    { "data-revealing": paced.revealing, "data-primed": paced.primeLength },
    paced.text,
  );
}
function render(text: string, streaming = true, options?: TextRevealOptions) {
  act(() => root.render(createElement(Probe, { text, streaming, options })));
}

function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 25)
    act(() => vi.advanceTimersByTime(Math.min(25, ms - elapsed)));
}
function steps() {
  return samples.slice(1).map((sample, i) => ({
    chars: sample.length - samples[i].length,
    elapsed: sample.time - samples[i].time,
    end: sample.length,
  }));
}
function expectBounded() {
  for (const step of steps()) {
    expect(step.chars).toBeGreaterThan(0);
    expect(step.chars).toBeLessThanOrEqual(32);
    expect(step.elapsed).toBeGreaterThanOrEqual(25);
  }
}

describe("smooth streaming", () => {
  it("keeps Unicode intact and never scans ahead through a long Markdown line", () => {
    for (const cluster of ["👩‍💻", "e\u0301", "🇨🇳"]) {
      const text = "a".repeat(21) + cluster + "tail";
      expect(revealBoundary(text, 0, 22)).toBe(21);
      expect(revealBoundary(text, 21, cluster.length)).toBe(
        21 + cluster.length,
      );
    }
    expect(revealBoundary("paragraph\n\n###", 0, 32)).toBe(11);
    expect(revealBoundary("###", 0)).toBe(0);
    expect(revealBoundary("###", 0, 32, false)).toBe(3);
    expect(revealBoundary("### " + "a".repeat(2000) + "\n", 0, 4)).toBe(4);
  });
  it.each([401, 1100, 5000])(
    "paces a %s-character first delivery with bounded, gradual acceleration and deceleration",
    (length) => {
      render("a".repeat(length));
      expect(host.textContent!.length).toBeLessThanOrEqual(4);
      advance((length / 1280) * 1000 + 2500);
      expect(host.textContent).toHaveLength(length);
      expectBounded();
      const increments = steps().filter((step) => step.end < length - 32);
      for (let i = 1; i < increments.length; i++)
        expect(
          Math.abs(increments[i].chars - increments[i - 1].chars),
        ).toBeLessThanOrEqual(2);
      expect(Math.max(...increments.map((step) => step.chars))).toBeGreaterThan(
        4,
      );
    },
  );
  it("paces a late burst, then drains a completed backlog within one message transition", () => {
    render("a".repeat(160));
    advance(100);
    const before = host.textContent!.length;
    render("a".repeat(4000));
    expect(host.textContent).toHaveLength(before);
    advance(300);
    const ending = host.textContent!.length;
    const finishedAt = performance.now();
    render("a".repeat(5000), false);
    expect(host.textContent).toHaveLength(ending);
    expect(host.firstElementChild?.getAttribute("data-revealing")).toBe("true");
    advance(200);
    expect(host.textContent).toHaveLength(5000);
    expect(host.firstElementChild?.getAttribute("data-revealing")).toBe(
      "false",
    );
    expect(samples.at(-1)!.time - finishedAt).toBeLessThanOrEqual(200);
  });
  it("paces a late final snapshot even after the earlier completed text has drained", () => {
    render("a".repeat(100));
    render("a".repeat(100), false);
    advance(1000);
    expect(host.textContent).toHaveLength(100);
    render("a".repeat(2000), false);
    expect(host.textContent).toHaveLength(100);
    advance(25);
    expect(host.textContent!.length).toBeGreaterThan(100);
    advance(175);
    expect(host.textContent).toHaveLength(2000);
  });
  it("keeps one bounded timer through StrictMode effect replay", () => {
    act(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Probe, { text: "a".repeat(2000) }),
        ),
      ),
    );
    advance(1000);
    expectBounded();
    expect(steps().length).toBe(40);
  });
  it("keeps its cadence when incoming updates are faster than the display timer", () => {
    render("");
    for (let i = 1; i <= 200; i++) {
      render("a".repeat(i * 10));
      act(() => vi.advanceTimersByTime(5));
    }
    expect(host.textContent!.length).toBeGreaterThan(600);
    expect(host.textContent!.length).toBeLessThan(2000);
    expectBounded();
    expect(
      Math.max(...steps().map((step) => step.elapsed)),
    ).toBeLessThanOrEqual(25);
    render("a".repeat(2000), false);
    advance(200);
    expect(host.textContent).toHaveLength(2000);
  });
  it("does not accumulate multiple display batches before a React commit", () => {
    render("a".repeat(5000));
    const before = host.textContent!.length;
    act(() => vi.advanceTimersByTime(5000));
    expect(host.textContent!.length - before).toBeLessThanOrEqual(32);
    advance(25);
    expect(steps()).toHaveLength(2);
    expect(steps().at(-1)!.chars).toBeLessThanOrEqual(128);
  });
  it("uses bounded delayed-timer time and drains unfinished Markdown markers at completion", () => {
    render("a".repeat(5000));
    advance(300);
    const before = host.textContent!.length;
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => clock() + 5000);
    advance(25);
    expect(host.textContent!.length - before).toBeGreaterThan(16);
    expect(host.textContent!.length - before).toBeLessThanOrEqual(128);
    render("");
    render("###");
    advance(100);
    expect(host.textContent).toBe("");
    render("###", false);
    advance(100);
    expect(host.textContent).toBe("###");
    expect(host.firstElementChild?.getAttribute("data-revealing")).toBe(
      "false",
    );
  });
  it("keeps snapshot corrections from flushing an undisplayed live tail", () => {
    render("a".repeat(5000));
    advance(100);
    const before = host.textContent!.length;
    render("b" + "a".repeat(5999));
    expect(host.textContent).toHaveLength(before);
    expect(host.textContent!.startsWith("b")).toBe(true);
    advance(25);
    expect(host.textContent!.length - before).toBeLessThanOrEqual(32);
  });
  it("shows completed history and an explicitly seeded live history immediately", () => {
    render("history ".repeat(1000), false);
    expect(host.textContent).toHaveLength(8000);
    act(() => root.unmount());
    root = createRoot(host);
    render("history ".repeat(1000), true, { initialLength: 8000 });
    expect(host.textContent).toHaveLength(8000);
    render("history ".repeat(1000) + "new ".repeat(400));
    expect(host.textContent).toHaveLength(8000);
    render("history ".repeat(1000) + "new ".repeat(400), true, {
      settledLength: 9600,
    });
    expect(host.textContent).toHaveLength(9600);
  });
  it("does not replay a visible prefix when a reply remounts with newer text", () => {
    render("history ".repeat(20), true, { initialLength: 50 });
    expect(host.textContent).toHaveLength(50);
    expect(host.firstElementChild?.getAttribute("data-primed")).toBe("50");
  });
  it("handles replacement and truncation, then paces a restarted stream", () => {
    render("a".repeat(100));
    render("replacement");
    expect(host.textContent).toBe("repl");
    advance(200);
    expect(host.textContent).toBe("replacement");
    render("replace");
    expect(host.textContent).toBe("replace");
    render("replace", false);
    render("replace" + "b".repeat(100));
    expect(host.textContent).toBe("replace");
    advance(200);
    expect(host.textContent!.length).toBeGreaterThan(7);
  });
  it("flushes background and reduced-motion output, then resumes bounded live updates", () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    render("a".repeat(2000));
    advance(100);
    act(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(host.textContent).toHaveLength(2000);
    render("a".repeat(4000), false);
    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(host.textContent).toHaveLength(4000);
    render("a".repeat(6000), true);
    expect(host.textContent).toHaveLength(4000);
    advance(25);
    expect(host.textContent!.length - 4000).toBeLessThanOrEqual(32);
    act(() => applyReducedMotion("on"));
    expect(host.textContent).toHaveLength(6000);
    render("a".repeat(8000));
    expect(host.textContent).toHaveLength(8000);
  });
});

describe("phrase fades", () => {
  it("limits the horizon, settles to a plain prefix, and never replays a settled run", () => {
    const fade = new WordFadeManager();
    fade.sync("a".repeat(400), true, 0, 0);
    const run = fade.reveal("0", "a".repeat(400), 0, 0);
    expect(run.chunks.length).toBeGreaterThan(1);
    expect(run.chunks.at(-1)?.start).toBeLessThanOrEqual(600);
    expect(fade.reveal("0", run.text, 0, 801).chunks).toHaveLength(0);
    expect(fade.reveal("0", run.text, 0, 900).plain).toBe(400);
    expect(fade.reveal("0", run.text + "new", 0, 901).chunks).toHaveLength(1);
  });
  it("primes history but preserves fades during fast delivery", () => {
    const fade = new WordFadeManager();
    fade.sync("history", true, 7, 0);
    expect(fade.reveal("0", "history", 0, 0).chunks).toHaveLength(0);
    fade.sync("history" + "a".repeat(400), true, 7, 100);
    expect(
      fade.reveal("7", "a".repeat(400), 7, 100).chunks.length,
    ).toBeGreaterThan(0);
  });
  it("fades appended text only, collapses spans while streaming, and preserves inline links", () => {
    const renderMarkdown = (text: string, streaming = true) =>
      act(() => root.render(createElement(AgentMarkdown, { text, streaming })));
    renderMarkdown("Hello there.");
    expect(host.querySelector("[data-word-fade]")).not.toBeNull();
    advance(1000);
    expect(host.textContent).toBe("Hello there.");
    expect(host.querySelector("[data-word-fade]")).toBeNull();
    renderMarkdown("Hello there. New words arrive.");
    advance(200);
    const faded = [...host.querySelectorAll("[data-word-fade]")]
      .map((span) => span.textContent)
      .join("");
    expect(faded).not.toContain("Hello");
    renderMarkdown(
      "See [the guide](https://example.com) and `hello world`.",
      false,
    );
    advance(1000);
    expect(host.querySelector("a")?.textContent).toBe("the guide");
    expect(host.querySelector("code")?.textContent).toBe("hello world");
    expect(host.querySelector("[data-word-fade]")).toBeNull();
  });
});
