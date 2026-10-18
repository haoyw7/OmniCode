import { animate, motionValue, useMotionValue, type AnimationPlaybackControls, type Transition } from "motion/react";
import { useEffect } from "react";
import { reducedMotionQuery } from "../shared/lib/reducedMotion";
// Follows the Android soft keyboard. MainActivity reports where the keyboard
// is heading, with its duration and easing curve, as each animation starts.
// The WebView stays full screen. Only the mobile shell's height changes, once
// at the end of a rise or the start of a dismissal. This avoids invalidating
// viewport-dependent styles throughout the history when the keyboard closes.

export interface KeyboardMotion {
  /** Keyboard height the animation ends at, in CSS pixels. */
  height: number;
  /** Height before this motion. */
  previous: number;
  duration: number;
  easing: string;
}

export const KEYBOARD_EVENT = "monocode:keyboard";
const FALLBACK_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const MOTION_SURFACES = [
  ".mobile-notes",
  ".mobile-composer-dock",
  ".mobile-assistant-compose-dock",
  ".mobile-desktop-transcript",
  '.assistant-chat[data-layout="mobile"] .assistant-messages',
  ".mobile-sheet-backdrop",
  ".mobile-modal-backdrop",
  ".mobile-shared-question",
  ".mobile-shared-question-dock",
  ".mobile-command-suggestions",
  ".mobile-assistant-settings-actions",
  ".mobile-home-dock",
].join(", ");
const MOTION_PROPERTIES = [
  "--mobile-keyboard-height",
  "--mobile-keyboard-duration",
  "--mobile-keyboard-easing",
  "--mobile-keyboard-follow",
  "--mobile-assistant-keyboard-follow",
  "--mobile-keyboard-layout",
  "--mobile-keyboard-clearance",
] as const;

let height = 0;
let tracked = false;
let motionEndsAt = 0;
let fullViewport = 0;
const listeners = new Set<(motion: KeyboardMotion) => void>();

/** Whether the native shell reports keyboard motion. */
export const keyboardTracked = () => tracked;
export const keyboardHeight = () => height;
/** Usable screen height even though Android keeps the WebView full screen. */
export const keyboardViewportHeight = () => tracked
  ? Math.max(0, fullViewport - height)
  : (window.visualViewport?.height ?? window.innerHeight);
/** Remaining native motion, including for a sheet opened midway through it. */
export const keyboardMotionRemaining = () => Math.max(0, motionEndsAt - performance.now());

export function onKeyboardMotion(listener: (motion: KeyboardMotion) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Some Android skins move the keyboard on a spring that passes its target.
 * Bottom controls ride the keyboard's progress, so an overshooting curve
 * throws them above their resting place before they fall back. Clamp the
 * sampled progress to [0, 1] and keep it monotonic: a spring can dip below 1
 * again after overshooting. The keyboard keeps its timing and the controls
 * settle once instead of following that rebound.
 */
export function settledEasing(easing: string) {
  const match = /^\s*linear\((.*)\)\s*$/.exec(easing);
  if (!match) return easing;
  let progress = 0;
  const stops = match[1].split(",").map((stop) =>
    stop.trim().replace(/^-?[\d.]+(?:e-?\d+)?/i, (value) => {
      progress = Math.min(1, Math.max(progress, Number(value)));
      return String(progress);
    }),
  );
  return `linear(${stops.join(", ")})`;
}

function supportedEasing(easing: unknown) {
  if (typeof easing !== "string" || !easing) return FALLBACK_EASING;
  if (typeof CSS === "undefined" || !CSS.supports) return settledEasing(easing);
  return CSS.supports("transition-timing-function", easing)
    ? settledEasing(easing)
    : FALLBACK_EASING;
}

/**
 * How much of the keyboard's travel the transcript content follows. The
 * transcript keeps its distance from the bottom while pinned; otherwise its
 * scroll offset only moves when the taller viewport runs out of content.
 * `contentHeight` is the content's height once the viewport has resized.
 */
export function transcriptFollow(
  scroller: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  contentHeight: number,
  delta: number,
  scrollLimit = Infinity,
): number {
  if (!delta) return 0;
  const { scrollTop, clientHeight } = scroller;
  const pinned = scroller.scrollHeight - scrollTop - clientHeight <= 2;
  const viewport = clientHeight - delta;
  const nextMax = Math.max(0, contentHeight - viewport);
  const shift =
    delta > 0
      ? pinned
        ? Math.min(nextMax, scrollLimit) - scrollTop
        : 0
      : scrollTop - Math.min(scrollTop, nextMax);
  return Math.max(0, Math.min(1, shift / Math.abs(delta)));
}

/**
 * Height of the turn anchored after a send once the viewport changes by
 * `delta`. Its minimum height tracks the transcript viewport, so a short
 * reply's empty space shrinks under a rising keyboard instead of pushing the
 * conversation up.
 */
export function anchoredTurnHeight(
  turn: { height: number; minHeight: number; natural: number },
  delta: number,
): number {
  return Math.max(turn.natural, turn.minHeight - delta);
}

function anchoredTurnChange(scroller: HTMLElement, delta: number) {
  const turn = scroller.querySelector<HTMLElement>(".transcript-turn-anchor");
  if (!turn) return 0;
  const minHeight = parseFloat(getComputedStyle(turn).minHeight) || 0;
  if (minHeight <= 0) return 0;
  const height = turn.offsetHeight;
  // Measured once per keyboard motion, before the motion starts.
  // Temporarily shrinking the turn can clamp the browser's scroll offset.
  // Restore it with the minimum height before any follow or paint observes it.
  const scrollTop = scroller.scrollTop;
  const previous = turn.style.minHeight;
  turn.style.minHeight = "0px";
  const natural = turn.offsetHeight;
  turn.style.minHeight = previous;
  scroller.scrollTop = scrollTop;
  return anchoredTurnHeight({ height, minHeight, natural }, delta) - height;
}

function contentRatio(delta: number) {
  // Departing pages remain mounted through their exit. Their transcript
  // appears first in DOM order but must not control the active keyboard lift.
  const scroller = [...document.querySelectorAll<HTMLElement>(
    ".mobile-desktop-transcript > .agent-transcript",
  )].find(element => !element.closest('[inert], [aria-hidden="true"]'));
  if (!scroller) return 0;
  const style = getComputedStyle(scroller);
  const surface = scroller.parentElement!;
  const surfaceStyle = getComputedStyle(surface);
  const safeGap = parseFloat(surfaceStyle.getPropertyValue("--mobile-composer-safe-gap")) || 0;
  const layout = parseFloat(surfaceStyle.getPropertyValue("--mobile-keyboard-layout")) || 0;
  const gapChange = Math.min(safeGap, height) - Math.min(safeGap, layout);
  const inner = scroller.firstElementChild as HTMLElement | null;
  const content =
    (inner?.offsetHeight ?? 0) +
    (parseFloat(style.paddingTop) || 0) +
    (parseFloat(style.paddingBottom) || 0) +
    anchoredTurnChange(scroller, delta - gapChange) - gapChange;
  return transcriptFollow(scroller, content, delta);
}

function assistantContentRatio(delta: number) {
  const scroller = [...document.querySelectorAll<HTMLElement>(
    '.assistant-chat[data-layout="mobile"] .assistant-messages',
  )].find(element => !element.closest('[inert], [aria-hidden="true"]'));
  const last = scroller?.lastElementChild;
  if (!scroller || !last || (delta > 0 && scroller.dataset.followLatest === "false")) return 0;
  const style = getComputedStyle(scroller);
  const top = scroller.getBoundingClientRect().top;
  const content = last.getBoundingClientRect().bottom - top + scroller.scrollTop +
    (parseFloat(style.paddingBottom) || 0);
  let latest = last;
  if (latest.matches(".assistant-working") && latest.previousElementSibling)
    latest = latest.previousElementSibling;
  const limit = latest.matches(".assistant-message-row, .assistant-card, .assistant-input")
    ? latest.getBoundingClientRect().top - top + scroller.scrollTop -
      (parseFloat(style.scrollPaddingTop) || 0)
    : Infinity;
  return transcriptFollow(scroller, content, delta, limit);
}

/** Current visual lift is shared with anchored menus without a style-sampling loop. */
export const keyboardLift = motionValue(0);
const settledListeners = new Set<() => void>();
export function onKeyboardSettled(listener: () => void) {
  settledListeners.add(listener);
  return () => { settledListeners.delete(listener); };
}

/** React consumers can derive their own transforms without rerendering per frame. */
export function useKeyboardMotionValue() {
  const value = useMotionValue(keyboardLift.get());
  useEffect(() => keyboardLift.on("change", next => value.set(next)), [value]);
  return value;
}

function motionEasing(easing: string): Transition["ease"] {
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(easing);
  if (bezier) return bezier[1].split(",").map(Number) as [number, number, number, number];
  const linear = /^linear\((.*)\)$/.exec(easing);
  if (!linear) return "linear";
  const stops = linear[1].split(",").map((stop, index, all) => {
    const [value, position] = stop.trim().split(/\s+/);
    return { value: Number(value), position: position?.endsWith("%") ? parseFloat(position) / 100 : index / (all.length - 1) };
  });
  return progress => {
    const right = stops.findIndex(stop => stop.position >= progress);
    if (right <= 0) return right < 0 ? 1 : stops[0].value;
    const from = stops[right - 1], to = stops[right];
    const portion = (progress - from.position) / Math.max(Number.EPSILON, to.position - from.position);
    return from.value + portion * (to.value - from.value);
  };
}

export function installKeyboardMotion(root = document.documentElement) {
  const surfaces = new Set<HTMLElement>();
  const shells = new Map<HTMLElement, string>();
  let layout = height;
  let clearance = height;
  let animation: AnimationPlaybackControls | undefined;
  const progress = motionValue(0);
  let styles: Record<(typeof MOTION_PROPERTIES)[number], string> = {
    "--mobile-keyboard-height": `${height}px`,
    "--mobile-keyboard-duration": "0ms",
    "--mobile-keyboard-easing": FALLBACK_EASING,
    "--mobile-keyboard-follow": "0",
    "--mobile-assistant-keyboard-follow": "0",
    "--mobile-keyboard-layout": `${layout}px`,
    "--mobile-keyboard-clearance": `${clearance}px`,
  };
  const sizeShell = (element: HTMLElement) => {
    if (tracked) element.style.height = `${Math.max(0, fullViewport - layout)}px`;
  };
  const attachShell = (element: Element) => {
    if (!(element instanceof HTMLElement) || shells.has(element)) return;
    shells.set(element, element.style.height);
    sizeShell(element);
  };
  const sync = (element: HTMLElement, animate: boolean) => {
    for (const property of MOTION_PROPERTIES) {
      const value = property === "--mobile-keyboard-duration" && !animate
        ? "0ms" : styles[property];
      if (element.style.getPropertyValue(property) !== value)
        element.style.setProperty(property, value);
    }
  };
  const attach = (element: Element) => {
    if (!(element instanceof HTMLElement) || surfaces.has(element)) return;
    surfaces.add(element);
    // A newly mounted menu starts at the current keyboard height, without
    // replaying a motion that began before the menu existed.
    sync(element, false);
    element.style.setProperty("--mobile-keyboard", `${keyboardLift.get()}px`);
  };
  const scan = (element: Element) => {
    if (element.matches(".mobile-app")) attachShell(element);
    element.querySelectorAll(".mobile-app").forEach(attachShell);
    if (element.matches(MOTION_SURFACES)) attach(element);
    element.querySelectorAll(MOTION_SURFACES).forEach(attach);
  };
  const release = (element: HTMLElement) => {
    for (const property of MOTION_PROPERTIES) element.style.removeProperty(property);
    element.style.removeProperty("--mobile-keyboard");
    surfaces.delete(element);
  };
  scan(root);
  const mounts = new MutationObserver(records => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element) scan(node);
    for (const element of surfaces)
      if (!root.contains(element)) release(element);
    for (const [element, original] of shells) {
      if (root.contains(element)) continue;
      element.style.height = original;
      shells.delete(element);
    }
  });
  mounts.observe(root, { childList: true, subtree: true });
  const cancelSettle = () => { animation?.stop(); animation = undefined; };
  const stopLift = keyboardLift.on("change", lift => {
    for (const element of surfaces) element.style.setProperty("--mobile-keyboard", `${lift}px`);
  });
  const commitLayout = () => {
    layout = height;
    styles["--mobile-keyboard-layout"] = `${layout}px`;
    for (const shell of shells.keys()) sizeShell(shell);
    for (const element of surfaces) sync(element, true);
  };
  const settle = () => {
    clearance = height;
    styles["--mobile-keyboard-clearance"] = `${clearance}px`;
    commitLayout();
    for (const listener of settledListeners) listener();
  };
  const receive = (event: Event) => {
    const detail = (event as CustomEvent).detail ?? {};
    const next = Number(detail.height);
    const viewport = Number(detail.viewport);
    if (!Number.isFinite(next) || !Number.isFinite(viewport) || viewport <= 0)
      return;
    tracked = true;
    fullViewport = viewport;
    const previous = height;
    height = Math.max(0, next);
    const duration = Math.max(0, Number(detail.duration) || 0);
    const easing = supportedEasing(detail.easing);
    const reduced = reducedMotionQuery().matches;
    const effectiveDuration = reduced ? 0 : duration;
    motionEndsAt = performance.now() + effectiveDuration;
    // Keep tall answer cards clear of both ends of a motion. In particular,
    // dismissal grows the shell immediately, but must not grow a card while
    // its surface is still lifted above the departing keyboard.
    clearance = effectiveDuration ? Math.max(clearance, layout, height) : height;
    // Measure the actual layout, which can still be at an earlier height if
    // a gesture reverses before the preceding rise has finished.
    const delta = height - layout;
    const follow = delta ? contentRatio(delta) : Number(styles["--mobile-keyboard-follow"]);
    const assistantFollow = delta ? assistantContentRatio(delta) : Number(styles["--mobile-assistant-keyboard-follow"]);
    if (root.style.getPropertyValue("--mobile-viewport-full") !== `${viewport}px`)
      root.style.setProperty("--mobile-viewport-full", `${viewport}px`);
    styles = {
      "--mobile-keyboard-height": `${height}px`,
      "--mobile-keyboard-duration": `${effectiveDuration}ms`,
      "--mobile-keyboard-easing": easing,
      "--mobile-keyboard-follow": String(follow),
      "--mobile-assistant-keyboard-follow": String(assistantFollow),
      "--mobile-keyboard-layout": `${layout}px`,
      "--mobile-keyboard-clearance": `${clearance}px`,
    };
    cancelSettle();
    // Grow the local layout before lowering controls. A rise reserves space
    // after its last animated frame, without ever resizing the WebView.
    if (height <= layout || !effectiveDuration) commitLayout();
    else for (const shell of shells.keys()) sizeShell(shell);
    if (effectiveDuration) {
      const from = keyboardLift.get();
      progress.jump(0);
      animation = animate(progress, 1, {
        onUpdate: amount => keyboardLift.set(from + (height - from) * amount),
        duration: effectiveDuration / 1000,
        ease: motionEasing(easing),
        onComplete: settle,
      });
    } else {
      keyboardLift.set(height);
      settle();
    }
    for (const element of surfaces) sync(element, true);
    const motion = { height, previous, duration: effectiveDuration, easing };
    for (const listener of listeners) listener(motion);
  };
  // The layout already keeps the composer above the keyboard. A WebView that
  // still pans the page to reveal the focused field would lift everything a
  // second keyboard height until its resize lands, so undo any pan at rest
  // scale (pinch zoom keeps its own offset).
  const viewport = window.visualViewport;
  const unpan = () => {
    if (
      (!viewport || viewport.scale <= 1.01) &&
      ((viewport?.offsetTop ?? 0) > 0 || window.scrollY > 0)
    )
      window.scrollTo(0, 0);
  };
  window.addEventListener(KEYBOARD_EVENT, receive);
  window.addEventListener("scroll", unpan);
  viewport?.addEventListener("scroll", unpan);
  viewport?.addEventListener("resize", unpan);
  return () => {
    cancelSettle();
    stopLift();
    keyboardLift.set(0);
    mounts.disconnect();
    for (const element of surfaces) release(element);
    for (const [element, original] of shells) element.style.height = original;
    window.removeEventListener(KEYBOARD_EVENT, receive);
    window.removeEventListener("scroll", unpan);
    viewport?.removeEventListener("scroll", unpan);
    viewport?.removeEventListener("resize", unpan);
    tracked = false;
    height = 0;
    motionEndsAt = 0;
    fullViewport = 0;
  };
}
