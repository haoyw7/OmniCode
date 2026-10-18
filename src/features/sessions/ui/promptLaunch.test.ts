// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishMotion,
  startMotionClock,
  stopMotionClock,
} from "../../../../tests/helpers/sharedMotionClock";
import { slidePromptIn, type PromptSlide } from "./promptLaunch";

let container: HTMLDivElement;
let slides: PromptSlide[];

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  startMotionClock();
  slides = [];
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  for (const slide of slides) slide.release();
  await finishMotion(2);
  container.remove();
  stopMotionClock();
  vi.unstubAllGlobals();
});

function part(name: string, opacity = 1) {
  const element = document.createElement("div");
  element.dataset.part = name;
  element.style.opacity = String(opacity);
  container.append(element);
  return element;
}

function translateY(element: HTMLElement) {
  const transform = element.style.transform;
  if (!transform || transform === "none") return 0;
  const translation = transform.match(/translateY\((-?[\d.]+)px\)/);
  expect(translation, `${element.dataset.part}: ${transform}`).not.toBeNull();
  return Number(translation![1]);
}

function expectAtRest(elements: HTMLElement[]) {
  for (const element of elements)
    expect(translateY(element), element.dataset.part).toBeCloseTo(0);
}

describe("prompt slide release with the real Motion engine", () => {
  it.each([
    { state: "running", settle: true },
    { state: "running", settle: false },
    { state: "finished", settle: true },
    { state: "finished", settle: false },
  ] as const)("lands $state bubble, media, earlier turn and recorded replacements (settle=$settle)", async ({ state, settle }) => {
    const expectedOpacity = settle ? 1 : 0.5;
    const bubble = part("bubble", expectedOpacity);
    const media = part("media", expectedOpacity);
    const earlier = part("earlier", 0.8);
    const recordedBubble = part("recorded-bubble", expectedOpacity);
    const recordedMedia = part("recorded-media", expectedOpacity);
    const moved = [bubble, media, earlier, recordedBubble, recordedMedia];
    const slide = slidePromptIn([bubble, media], 80, [earlier], { settle })!;
    slides.push(slide);
    await finishMotion(3);
    expect(translateY(bubble)).toBeGreaterThan(0);
    expect(slide.follow([recordedBubble, recordedMedia])).toBe(true);
    await finishMotion(1);
    for (const element of moved) expect(translateY(element)).toBeGreaterThan(0);

    if (state === "finished") {
      await finishMotion();
      await slide.finished;
      expectAtRest(moved);
    }

    slide.release();
    slide.release();
    expect(slide.follow([part("late-recorded-copy")])).toBe(false);
    await slide.finished;
    // The first rendered frame after interruption must land every participant.
    await finishMotion(1);
    expectAtRest(moved);
    for (const element of [bubble, media, recordedBubble, recordedMedia])
      expect(Number(element.style.opacity), element.dataset.part).toBeCloseTo(expectedOpacity);
    expect(Number(earlier.style.opacity)).toBeCloseTo(0.8);

    // Neither deferred completion nor repeated release may restore the offset.
    await finishMotion();
    slide.release();
    await finishMotion(1);
    expectAtRest(moved);
    for (const element of [bubble, media, recordedBubble, recordedMedia])
      expect(Number(element.style.opacity), element.dataset.part).toBeCloseTo(expectedOpacity);
  });

  it("lands a released slide before its first animation paint", async () => {
    const bubble = part("bubble");
    const media = part("media");
    const earlier = part("earlier");
    const slide = slidePromptIn([bubble, media], 80, [earlier])!;
    slides.push(slide);
    slide.release();
    expect(slide.follow([part("recorded-after-release")])).toBe(false);
    await finishMotion(1);
    expectAtRest([bubble, media, earlier]);
    expect(Number(bubble.style.opacity)).toBe(1);
    expect(Number(media.style.opacity)).toBe(1);
    await finishMotion();
    expectAtRest([bubble, media, earlier]);
  });
});
