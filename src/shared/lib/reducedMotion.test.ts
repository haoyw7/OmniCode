// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { applyReducedMotion, prefersReducedMotion, reducedMotionQuery } from "./reducedMotion";

afterEach(() => {
  applyReducedMotion("system");
  vi.restoreAllMocks();
});

it("reuses the media query while reading live system and application preferences", () => {
  let matches = false;
  const events = new EventTarget();
  const media = {
    get matches() { return matches; },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as MediaQueryList;
  const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue(media);
  const query = reducedMotionQuery();
  const listener = vi.fn();
  query.addEventListener("change", listener);
  for (let index = 0; index < 20; index++) {
    expect(reducedMotionQuery()).toBe(query);
    expect(prefersReducedMotion()).toBe(false);
  }
  expect(matchMedia).toHaveBeenCalledOnce();

  matches = true;
  events.dispatchEvent(new Event("change"));
  expect(listener).toHaveBeenCalledOnce();
  expect(prefersReducedMotion()).toBe(true);
  applyReducedMotion("off");
  expect(prefersReducedMotion()).toBe(false);
  applyReducedMotion("on");
  expect(prefersReducedMotion()).toBe(true);
  applyReducedMotion("system");
  expect(prefersReducedMotion()).toBe(true);

  query.removeEventListener("change", listener);
  listener.mockClear();
  events.dispatchEvent(new Event("change"));
  applyReducedMotion("off");
  expect(listener).not.toHaveBeenCalled();
  expect(matchMedia).toHaveBeenCalledOnce();
});
