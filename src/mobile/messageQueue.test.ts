import { startMotionClock, motionFrame, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileMessageQueue } from "./MobileMessageQueue";
import { MOBILE_MATERIAL_SELECTOR } from "./theme/material";
import { setUiLanguage } from "../shared/i18n/language";
import type { QueuedMessage } from "../features/sessions/model/session";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
const mobileCss = ["src/mobile/theme/tokens.css", ...readdirSync("src/mobile/styles").filter((name) => /^\d+-.+\.css$/.test(name)).sort().map((name) => `src/mobile/styles/${name}`)]
  .map((path) => readFileSync(path, "utf8")).join("\n");
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root, node: HTMLDivElement;
const message: QueuedMessage = {
  id: "queued",
  text: "Message with image",
  intent: "plan",
  attachments: [
    {
      id: "photo",
      name: "photo.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      data: "YWJj",
    },
  ],
};
beforeEach(() => {
  startMotionClock();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  stopMotionClock();
  vi.useRealTimers();
});

function pointer(type: string, y: number, target: EventTarget) {
  target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: y, bubbles: true, cancelable: true }));
}
function sortableQueue(onReorder = vi.fn()) {
  const messages = [message, { ...message, id: "second", text: "Second" }, { ...message, id: "third", text: "Third" }];
  render({ messages, onReorder });
  const pills = [...node.querySelectorAll<HTMLButtonElement>(".mobile-queue-pills > button")];
  pills.forEach((pill, index) => pill.getBoundingClientRect = () => ({ left: 20, top: 100 + index * 51, width: 200, height: 44, right: 220, bottom: 144 + index * 51 }) as DOMRect);
  const list = node.querySelector<HTMLElement>(".mobile-queue-pills")!;
  list.getBoundingClientRect = () => ({ top: 100, bottom: 260 }) as DOMRect;
  return { pills, onReorder };
}
it("requires a long press, previews the new order and saves the dragged row relative to its successor", async () => {
  vi.useFakeTimers();
  const { pills, onReorder } = sortableQueue();
  act(() => pointer("pointerdown", 122, pills[0]));
  act(() => vi.advanceTimersByTime(399));
  expect(node.querySelector('.mobile-queue-drag-preview')).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(node.querySelector('.mobile-queue-drag-preview')).not.toBeNull();
  act(() => { pointer("pointermove", 175, window); vi.advanceTimersByTime(16); motionFrame(); });
  expect([...node.querySelectorAll<HTMLElement>('.mobile-queue-pills > button')].map(row => row.dataset.queueId)).toEqual(['second','queued','third']);
  await act(async () => pointer("pointerup", 175, window));
  expect(onReorder).toHaveBeenCalledWith('queued','third');
  act(() => pills[0].click());
  expect(node.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["pointercancel", "Escape"])("cancels a drag on %s without saving or opening actions", async (action) => {
  vi.useFakeTimers();
  const { pills, onReorder } = sortableQueue();
  act(() => { pointer("pointerdown",122,pills[0]); vi.advanceTimersByTime(400); pointer("pointermove",224,window); });
  act(() => action === "Escape" ? window.dispatchEvent(new KeyboardEvent("keydown",{key:'Escape'})) : pointer("pointercancel",224,window));
  expect(node.querySelector('.mobile-queue-drag-preview')).toBeNull();
  expect(onReorder).not.toHaveBeenCalled();
  expect([...node.querySelectorAll<HTMLElement>('.mobile-queue-pills > button')].map(row => row.dataset.queueId)).toEqual(['queued','second','third']);
});
it("treats movement before the hold as scrolling and preserves a short tap for the actions menu", async () => {
  vi.useFakeTimers();
  const { pills, onReorder } = sortableQueue();
  act(() => { pointer('pointerdown',122,pills[0]); pointer('pointermove',142,window); vi.advanceTimersByTime(500); pointer('pointerup',142,window); });
  expect(node.querySelector('.mobile-queue-drag-preview')).toBeNull();
  expect(onReorder).not.toHaveBeenCalled();
  act(() => { pointer('pointerdown',122,pills[0]); pointer('pointerup',122,window); pills[0].click(); });
  expect(node.querySelector('[role="dialog"]')).not.toBeNull();
});
it("reverts the preview and shows a failed reorder without losing any queue messages", async () => {
  vi.useFakeTimers();
  const { pills } = sortableQueue(vi.fn(async () => { throw new Error('Queued destination not found'); }));
  act(() => { pointer('pointerdown',122,pills[0]); vi.advanceTimersByTime(400); pointer('pointermove',224,window); });
  await act(async () => pointer('pointerup',224,window));
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('Queued destination not found');
  expect([...node.querySelectorAll<HTMLElement>('.mobile-queue-pills > button')].map(row => row.dataset.queueId)).toEqual(['queued','second','third']);
});
it("cancels when another device changes the queue while dragging", () => {
  vi.useFakeTimers();
  const { pills, onReorder } = sortableQueue();
  act(() => { pointer('pointerdown',122,pills[0]); vi.advanceTimersByTime(400); });
  render({ messages: [message], onReorder });
  act(() => pointer('pointerup',224,window));
  expect(node.querySelector('.mobile-queue-drag-preview')).toBeNull();
  expect(onReorder).not.toHaveBeenCalled();
});
function render(
  overrides: Partial<Parameters<typeof MobileMessageQueue>[0]> = {},
  visible = true,
) {
  const props = {
    messages: [message],
    remote: true,
    onRestore: vi.fn(),
    onDelete: vi.fn(),
    onSteer: vi.fn(),
    onResume: vi.fn(),
    onOverlayChange: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(MobileMessageQueue, props))));
  return props;
}
async function open() {
  await act(async () =>
    node.querySelector<HTMLButtonElement>(".mobile-queue-pill")!.click(),
  );
  await advanceMotionTimers(300);
}
async function click(label: string) {
  await act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")]
      .find((button) => button.textContent === label)!
      .click(),
  );
}
async function finishMenuExit() {
  const backdrop = node.querySelector<HTMLElement>(".mobile-sheet-backdrop")!;
  expect(backdrop.dataset.foldState).toBe("closing");
  expect(backdrop.hasAttribute("inert")).toBe(true);
  await advanceMotionTimers(600);
  expect(node.querySelector('[role="dialog"]')).toBeNull();
}
it.each(["frosted", "solid"])(
  "removes the queue fill and shadows while preserving the border and glass in %s mode",
  (effect) => {
    const html = document.documentElement;
    const previousEffect = html.getAttribute("data-mobile-glass");
    const previousClass = html.className;
    const style = document.createElement("style");
    style.textContent = mobileCss;
    document.body.append(style);
    node.className = "mobile-app";
    node.style.setProperty("--color-stroke", "#566370");
    render();
    const pill = node.querySelector<HTMLElement>(".mobile-queue-pill")!;
    const preview = document.createElement("div");
    preview.className = "mobile-queue-pill mobile-queue-drag-preview";
    node.append(preview);
    try {
      html.setAttribute("data-mobile-glass", effect);
      for (const theme of ["theme-dark", "theme-light"]) {
        html.className = theme;
        for (const item of [pill, preview]) {
          const computed = getComputedStyle(item);
          expect(computed.backgroundColor).toBe("transparent");
          expect(computed.borderTopWidth).toBe("1px");
          expect(computed.borderTopStyle).toBe("solid");
          expect(computed.borderTopColor).toBe("#566370");
          expect(computed.boxShadow).toBe("none");
          if (effect !== "solid") {
            expect(computed.getPropertyValue("backdrop-filter")).toContain("blur(");
          }
          expect(item.matches(MOBILE_MATERIAL_SELECTOR)).toBe(true);
        }
      }
    } finally {
      html.className = previousClass;
      if (previousEffect === null) html.removeAttribute("data-mobile-glass");
      else html.setAttribute("data-mobile-glass", previousEffect);
      style.remove();
    }
  },
);
it("shows one compact message bubble and keeps touch actions in the menu", async () => {
  render();
  expect(node.querySelectorAll("button")).toHaveLength(1);
  expect(node.querySelector('[role="dialog"]')).toBeNull();
  await open();
  expect(node.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    [...node.querySelectorAll(".mobile-sheet-row")].map(
      (row) => row.textContent,
    ),
  ).toEqual(["Edit message", "Use as steering", "Cancel message send"]);
});
it("returns the complete queued message, images and intent to the original composer callback", async () => {
  const props = render();
  await open();
  await click("Edit message");
  expect(props.onRestore).toHaveBeenCalledWith(message);
  expect(node.querySelector("textarea")).toBeNull();
  await finishMenuExit();
});
it("keeps the queue visible and reports restore failures", async () => {
  render({
    onRestore: async () => {
      throw new Error("Image unavailable");
    },
  });
  await open();
  await click("Edit message");
  expect(node.querySelector('[role="alert"]')?.textContent).toContain(
    "Image unavailable",
  );
  expect(node.querySelector(".mobile-queue-pill")).not.toBeNull();
});
it("disables unavailable steering while leaving edit and cancellation usable", async () => {
  const props = render({ canSteer: false });
  await open();
  expect(
    [...node.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")].find(
      (button) => button.textContent === "Use as steering",
    )!.disabled,
  ).toBe(true);
  await click("Cancel message send");
  expect(props.onDelete).toHaveBeenCalledWith("queued");
});
it("steers the selected queue row", async () => {
  const props = render();
  await open();
  await click("Use as steering");
  expect(props.onSteer).toHaveBeenCalledWith("queued");
});
it("closes with Escape and restores focus without changing the message", async () => {
  const props = render();
  await open();
  act(() =>
    node
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  await finishMenuExit();
  expect(document.activeElement).toBe(node.querySelector(".mobile-queue-pill"));
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(props.onRestore).not.toHaveBeenCalled();
});
it("provides the native Back handler while a queue menu is open", async () => {
  const props = render();
  await open();
  const close = props.onOverlayChange.mock.calls.find((args) => args[0])![0]!;
  act(() => close());
  await finishMenuExit();
  expect(props.onOverlayChange).toHaveBeenLastCalledWith();
});
it("cancels an active drag when its page becomes hidden", () => {
  vi.useFakeTimers();
  const { pills, onReorder } = sortableQueue();
  act(() => { pointer("pointerdown", 122, pills[0]); vi.advanceTimersByTime(400); });
  expect(node.querySelector(".mobile-queue-drag-preview")).not.toBeNull();
  render({ messages: [message, { ...message, id: "second", text: "Second" }, { ...message, id: "third", text: "Third" }], onReorder }, false);
  act(() => pointer("pointerup", 224, window));
  expect(node.querySelector(".mobile-queue-drag-preview")).toBeNull();
  expect(onReorder).not.toHaveBeenCalled();
});
it("localizes attachment-only bubbles and menu labels", async () => {
  setUiLanguage("zh-CN");
  render({ messages: [{ ...message, text: "" }] });
  expect(node.querySelector(".mobile-queue-pill")?.textContent).toContain(
    "排队附件（1 个）",
  );
  await open();
  expect(node.textContent).toContain("编辑消息");
  expect(node.textContent).toContain("取消消息发送");
});
