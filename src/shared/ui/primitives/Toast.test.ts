// @vitest-environment happy-dom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishMotion, startMotionClock, stopMotionClock } from "../../../../tests/helpers/sharedMotionClock";
import { applyReducedMotion } from "../../lib/reducedMotion";

const mountedRoots = vi.hoisted(() => [] as Root[]);
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      mountedRoots.push(root);
      return root;
    },
  };
});
import { dismissToast, toast, type ToastOptions } from "./Toast";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
});
afterEach(() => {
  act(() => {
    applyReducedMotion("system");
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.getElementById("workflow-toast-host")?.remove();
  document.getElementById("toast-anchor")?.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(message: string, options: ToastOptions = {}) {
  let id = -1;
  await act(async () => {
    id = toast(message, {
      durationMs: 0,
      variant: "info",
      actionLabel: `Act ${message}`,
      dismissible: true,
      ...options,
    });
  });
  await act(async () => vi.advanceTimersByTime(16));
  await act(async () => finishMotion());
  return id;
}

function action(message: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("#workflow-toast-host button")]
    .find((button) => button.textContent === `Act ${message}`)!;
}
function surface(message: string) {
  return action(message).closest<HTMLElement>(".rounded-2xl")!;
}

it("disables every action as soon as a clicked toast starts exiting", async () => {
  const onAction = vi.fn();
  await show("clicked", { onAction });
  const button = action("clicked");
  const notice = surface("clicked");
  await act(async () => button.click());
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(notice.isConnected).toBe(true);
  expect(notice.inert).toBe(true);
  expect(notice.getAttribute("aria-hidden")).toBe("true");
  for (const retainedButton of notice.querySelectorAll<HTMLButtonElement>("button")) {
    expect(retainedButton.disabled).toBe(true);
    act(() => retainedButton.click());
  }
  expect(onAction).toHaveBeenCalledTimes(1);
  await act(async () => finishMotion());
  expect(notice.isConnected).toBe(false);
});

it("keeps an automatically expired notice inert until its exit completes", async () => {
  const onAction = vi.fn();
  await show("expired", { durationMs: 100, onAction });
  const notice = surface("expired");
  await act(async () => vi.advanceTimersByTime(100));
  expect(notice.isConnected).toBe(true);
  expect(notice.inert).toBe(true);
  act(() => action("expired").click());
  expect(onAction).not.toHaveBeenCalled();
  await act(async () => finishMotion());
  expect(notice.isConnected).toBe(false);
});

it.each([false, true])("retains a programmatically dismissed toast through exit (anchored=%s)", async (anchored) => {
  if (anchored) {
    const anchor = document.createElement("div");
    anchor.id = "toast-anchor";
    document.body.append(anchor);
  }
  const id = await show("dismissed", { anchorId: anchored ? "toast-anchor" : undefined });
  const notice = surface("dismissed");
  await act(async () => dismissToast(id));
  expect(notice.isConnected).toBe(true);
  expect(notice.inert).toBe(true);
  await act(async () => finishMotion());
  expect(notice.isConnected).toBe(false);
});

it("keeps a replaced deduplicated notice inert while the new action is available", async () => {
  const oldAction = vi.fn();
  const newAction = vi.fn();
  await show("old", { dedupeKey: "operation", onAction: oldAction });
  const oldNotice = surface("old");
  await act(async () => {
    toast("new", {
      durationMs: 0,
      variant: "info",
      actionLabel: "Act new",
      dedupeKey: "operation",
      onAction: newAction,
    });
  });
  expect(oldNotice.isConnected).toBe(true);
  expect(oldNotice.inert).toBe(true);
  expect(surface("new").inert).toBe(false);
  act(() => action("old").click());
  expect(oldAction).not.toHaveBeenCalled();
  await act(async () => finishMotion());
  expect(oldNotice.isConnected).toBe(false);
  await act(async () => action("new").click());
  expect(newAction).toHaveBeenCalledTimes(1);
});

it("suppresses entrance movement and completes dismissal under reduced motion", async () => {
  act(() => applyReducedMotion("on"));
  const id = await show("reduced");
  const notice = surface("reduced");
  expect(notice.style.opacity).toBe("1");
  expect(notice.style.transform).toBe("none");
  await act(async () => dismissToast(id));
  await act(async () => finishMotion(2));
  expect(notice.isConnected).toBe(false);
});
