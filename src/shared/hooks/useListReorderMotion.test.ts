// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useListReorderMotion } from "./useListReorderMotion";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("../motion/useMotionPreference", () => ({
  useMotionPreference: () => preference.reduced,
}));

let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function List({ order, animate, hidden = [] }: { order: string[]; animate: boolean; hidden?: string[] }) {
  const list = useRef<HTMLDivElement>(null);
  useListReorderMotion(list, order, "data-card", animate);
  return createElement("div", { ref: list }, order.map((id) =>
    createElement("div", { key: id, "data-card": id, hidden: hidden.includes(id) }, id),
  ));
}

function render(order: string[], animate = true, hidden: string[] = []) {
  act(() => root.render(createElement(List, { order, animate, hidden })));
}

// AutoAnimate plays each effect through a Web Animation. Browsers mark a
// cancelled animation's `finished` rejection as handled; happy-dom does not.
const play = Animation.prototype.play;
let played: Animation[] = [];
function playedEffects() {
  played = [];
  return () => played.map((animation) => animation.effect as KeyframeEffect);
}

// Let the real AutoAnimate MutationObserver process the React DOM commit.
const mutations = () => new Promise((resolve) => setTimeout(resolve, 10));
function nextPaint() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(performance.now())));
}

beforeEach(() => {
  preference.reduced = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // A `display: none` box reports zeros at the viewport origin.
    if (this.hidden) return new DOMRect(0, 0, 0, 0);
    const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
    return new DOMRect(0, index * 50, 200, 40);
  });
  vi.spyOn(Animation.prototype, "play").mockImplementation(function (this: Animation) {
    play.call(this);
    void this.finished.catch(() => {});
    played.push(this);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not replay a drag commit, then animates later programmatic sorting", async () => {
  render(["environment", "changes", "context"]);
  // AutoAnimate initializes its position cache asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const effects = playedEffects();
  render(["environment", "changes", "context"], false);
  render(["context", "environment", "changes"]);
  await mutations();
  expect(effects()).toEqual([]);
  expect([...host.querySelectorAll("[data-card]")].map((node) => node.textContent))
    .toEqual(["context", "environment", "changes"]);

  nextPaint();
  render(["changes", "context", "environment"]);
  await mutations();
  expect(effects().length).toBeGreaterThan(0);
  expect(effects().some((effect) =>
    effect.getKeyframes()[0]?.transform === "translate(0px, 100px)",
  )).toBe(true);
});

it("keeps animation disabled when a second drag starts before the next paint", async () => {
  render(["environment", "changes"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const effects = playedEffects();
  render(["environment", "changes"], false);
  render(["changes", "environment"]);
  render(["changes", "environment"], false);
  nextPaint();
  render(["environment", "changes"], false);
  await mutations();
  expect(effects()).toEqual([]);

  render(["environment", "changes"]);
  act(() => root.render(null));
  expect(frames.size).toBe(0);
});

it("cancels pending resumption when reduced motion is enabled", async () => {
  render(["environment", "changes"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const effects = playedEffects();
  render(["environment", "changes"], false);
  render(["changes", "environment"]);
  preference.reduced = true;
  render(["changes", "environment"]);
  nextPaint();
  render(["environment", "changes"]);
  await mutations();
  expect(effects()).toEqual([]);
});

it("opens a previously hidden row in place instead of sliding it from the origin", async () => {
  render(["archived", "kept", "revealed"], true, ["revealed"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const effects = playedEffects();
  render(["kept", "revealed"]);
  await mutations();
  const revealed = host.querySelector('[data-card="revealed"]');
  const kept = host.querySelector('[data-card="kept"]');
  const moves = (target: Element | null) => effects().filter((effect) =>
    effect.target === target && effect.getKeyframes().some((frame) => frame.transform),
  );
  expect(moves(revealed)).toEqual([]);
  expect(moves(kept)).toHaveLength(1);
});
