// @vitest-environment happy-dom
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { MobileComposer, type MobileComposerPanel } from "./MobileComposer";
import type { MobileConfiguration } from "./MobileModelControls";
import { setUiLanguage } from "../shared/i18n/language";
import { readMobileAttachments } from "./attachments";
import { KEYBOARD_EVENT, installKeyboardMotion } from "./keyboardMotion";
import { lightImpact } from "./haptics";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { applyReducedMotion } from "../shared/lib/reducedMotion";

vi.mock("./haptics", () => ({ lightImpact: vi.fn() }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { show: vi.fn(async () => {}) } }));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
beforeEach(() => {
  startMotionClock();
  setUiLanguage("en");
  vi.mocked(lightImpact).mockClear();
  vi.mocked(Keyboard.show).mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  stopMotionClock();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  applyReducedMotion("system");
});
async function finishMotion() { await act(async () => { for(let i=0;i<60;i++) { motionFrame(); await Promise.resolve(); } }); }
function render(overrides: Record<string, unknown> = {}) {
  const node = document.createElement("div");
  document.body.append(node);
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onFiles = vi.fn();
  const onProjectChange = vi.fn();
  let current = overrides;
  function TestApp() {
    const [panel, setPanel] = useState<MobileComposerPanel>(null);
    const [planMode, setPlanMode] = useState(false);
    return createElement(MobileComposer, {
      value: "Keep this draft",
      onChange: vi.fn(),
      configuration: {
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
      },
      lockedAgent: false,
      disabled: false,
      running: false,
      working: false,
      canSend: true,
      canStop: false,
      onConfigurationChange: vi.fn(),
      onSend,
      onStop,
      panel,
      onPanelChange: setPanel,
      catalog: {
        models: {
          codex: [{ id: "codex:test", name: "Test model", harness: "codex" }],
        },
        errors: {},
      },
      projects: [
        { id: "one", name: "monocode", cwd: "/projects/monocode" },
        { id: "two", name: "workbench", cwd: "/projects/workbench" },
      ],
      project: { id: "one", name: "monocode", cwd: "/projects/monocode" },
      onProjectChange,
      attachments: [],
      onFiles,
      onRemoveAttachment: vi.fn(),
      planMode,
      onPlanModeChange: setPlanMode,
      ...current,
    });
  }
  root = createRoot(node);
  act(() => root!.render(createElement(TestApp)));
  const button = (label: string) =>
    node.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = (label: string) => {
    if (button(label).closest('[aria-hidden="true"]'))
      act(() => node.querySelector("textarea")!.focus());
    act(() => {
      button(label).focus();
      button(label).click();
    });
  };
  const rerender = (next: Record<string, unknown>) => {
    current = { ...current, ...next };
    act(() => root!.render(createElement(TestApp)));
  };
  return { node, button, click, rerender, onSend, onStop, onFiles, onProjectChange };
}
function keyboard(height: number, duration = 285) {
  act(() =>
    window.dispatchEvent(
      new CustomEvent(KEYBOARD_EVENT, {
        detail: { height, viewport: 800, duration, easing: "linear(0, 1)" },
      }),
    ),
  );
}
function pointerTapKeepingFocus(target: HTMLElement) {
  act(() => {
    for (const event of [
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
      }),
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    ]) {
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    target.click();
  });
}
function touch(type: string, target: Element, clientX = 40, clientY = 100) {
  const point = new Touch({ identifier: 1, target, clientX, clientY });
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === "touchend" || type === "touchcancel" ? [] : [point],
    changedTouches: [point],
  });
  target.dispatchEvent(event);
  return event;
}
function tapKeepingFocus(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1,
    }));
    touch("touchstart", target);
    target.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, pointerType: "touch", pointerId: 1,
    }));
    expect(touch("touchend", target).defaultPrevented).toBe(true);
  });
}
describe("mobile composer popup focus", () => {
  it.each(["Upload photos", "Upload files"])("restores typing and the selection after %s without disabling the field during reading", (label) => {
    const { node, button, rerender, onFiles } = render();
    const area = node.querySelector("textarea")!;
    const input = node.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const picker = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => { area.focus(); area.setSelectionRange(3, 7, "backward"); });
    tapKeepingFocus(button("Add to message"));
    const row = [...node.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")]
      .find(element => element.textContent === label)!;
    tapKeepingFocus(row);
    expect(picker).toHaveBeenCalledOnce();
    act(() => area.blur());
    const file = new File(["image"], "photo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd, area.selectionDirection]).toEqual([3, 7, "backward"]);
    rerender({ readingAttachments: true, working: true, canSend: false });
    expect(area.disabled).toBe(false);
    expect(document.activeElement).toBe(area);
    expect(button("Add to message").disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(button("Send message").disabled).toBe(true);
    rerender({ readingAttachments: false, working: false, canSend: true });
    expect(document.activeElement).toBe(area);
    expect(button("Add to message").disabled).toBe(false);
  });

  it.each([0, 300])("restores only a previously open Android keyboard on picker cancellation (height: %s)", (height) => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    const uninstall = installKeyboardMotion();
    try {
      keyboard(height, 0);
      const { node, button, onFiles } = render();
      const area = node.querySelector("textarea")!;
      const input = node.querySelector<HTMLInputElement>('input[aria-label="Upload photos"]')!;
      vi.spyOn(input, "click").mockImplementation(() => {});
      act(() => { area.focus(); area.setSelectionRange(2, 4); });
      tapKeepingFocus(button("Add to message"));
      tapKeepingFocus([...node.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")]
        .find(element => element.textContent === "Upload photos")!);
      // The native picker hides the keyboard without clearing DOM focus.
      keyboard(0, 0);
      act(() => input.dispatchEvent(new Event("cancel", { bubbles: true })));
      expect(document.activeElement).toBe(area);
      expect([area.selectionStart, area.selectionEnd]).toEqual([2, 4]);
      expect(Keyboard.show).toHaveBeenCalledTimes(height ? 1 : 0);
      expect(onFiles).not.toHaveBeenCalled();
      act(() => area.blur());
      act(() => input.dispatchEvent(new Event("cancel", { bubbles: true })));
      expect(document.activeElement).not.toBe(area);
    } finally {
      uninstall();
    }
  });

  it("does not focus the composer after a picker opened without typing focus", () => {
    const { node, click } = render();
    const area = node.querySelector("textarea")!;
    const input = node.querySelector<HTMLInputElement>('input[aria-label="Upload files"]')!;
    vi.spyOn(input, "click").mockImplementation(() => {});
    click("Add to message");
    act(() => [...node.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")]
      .find(element => element.textContent === "Upload files")!.click());
    act(() => input.dispatchEvent(new Event("cancel", { bubbles: true })));
    expect(document.activeElement).not.toBe(area);
    expect(Keyboard.show).not.toHaveBeenCalled();
  });

  it("sends an image-only message while keeping the preview until acceptance", () => {
    const { node, click, onSend } = render({
      value: "",
      attachments: [{ id: "photo", name: "photo.png", mimeType: "image/png", kind: "image", data: "aGVsbG8=", size: 5 }],
    });
    click("Send message");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(node.querySelector(".mobile-composer-attachments img")).not.toBeNull();
  });

  it.each([
    "Add to message",
    "Model and reasoning",
    "Permissions: Supervised",
    "Plan mode",
  ])("keeps typing focus and the caret when opening and dismissing %s", (label) => {
    const { node, button } = render({ planMode: true });
    const area = node.querySelector("textarea")!;
    act(() => {
      area.focus();
      area.setSelectionRange(5, 9);
    });
    const blur = vi.fn();
    area.addEventListener("blur", blur);
    tapKeepingFocus(button(label));
    const sheet = node.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(document.activeElement).toBe(area);
    expect(sheet.getAttribute("aria-modal")).not.toBe("true");
    tapKeepingFocus(node.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([aria-hidden="true"])')!);
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([5, 9]);
    expect(area.value).toBe("Keep this draft");
    expect(blur).not.toHaveBeenCalled();
    expect(sheet.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state")).toBe("closing");
    expect(sheet.closest<HTMLElement>(".mobile-sheet-backdrop")?.inert).toBe(true);
    tapKeepingFocus(button(label));
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBe(sheet);
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([5, 9]);
  });

  it("keeps typing focus through model and reasoning submenus and option changes", () => {
    const onConfigurationChange = vi.fn();
    const { node, button } = render({
      onConfigurationChange,
      catalog: {
        models: {
          codex: [{
            id: "codex:test",
            name: "Test model",
            harness: "codex",
            settings: [{
              id: "reasoningEffort",
              label: "Reasoning",
              kind: "select",
              value: "high",
              options: [
                { value: "low", label: "Low" },
                { value: "high", label: "High" },
              ],
            }],
          }],
        },
        errors: {},
      },
    });
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    const blur = vi.fn();
    area.addEventListener("blur", blur);
    const row = (text: string) => [...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) .mobile-sheet-row')]
      .find((element) => element.querySelector("strong")?.textContent === text)!;
    tapKeepingFocus(button("Model and reasoning"));
    tapKeepingFocus(row("Model"));
    tapKeepingFocus(row("Test model"));
    tapKeepingFocus(row("Reasoning effort"));
    tapKeepingFocus(row("Low"));
    expect(onConfigurationChange).toHaveBeenLastCalledWith(expect.objectContaining({
      modelSettings: { reasoningEffort: "low" },
    }));
    expect(document.activeElement).toBe(area);
    expect(blur).not.toHaveBeenCalled();
  });

  it("keeps existing-session model controls open through saving consecutive choices", () => {
    const onConfigurationChange = vi.fn((_: MobileConfiguration) =>
      rerender({ disabled: true, working: true }),
    );
    const { node, button, click, rerender } = render({
      lockedAgent: true,
      allowHandoff: true,
      onConfigurationChange,
      catalog: {
        models: {
          codex: [
            {
              id: "codex:test", name: "Test model", harness: "codex",
              settings: [{
                id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high",
                options: [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
              }],
            },
            { id: "codex:other", name: "Other model", harness: "codex" },
          ],
          claude: [{ id: "claude:test", name: "Claude model", harness: "claude" }],
        },
        errors: {},
      },
    });
    const dialog = () => node.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]');
    const row = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>(".mobile-sheet-row")]
      .find((element) => element.querySelector("strong")?.textContent === label)!;
    click("Model and reasoning");
    const sheet = dialog();
    for (const [label, option] of [
      ["Reasoning effort", "Low"],
      ["Model", "Other model"],
      ["Agent", "Claude Code"],
    ]) {
      act(() => row(label).click());
      act(() => row(option).click());
      expect(dialog()).toBe(sheet);
      expect(dialog()!.getAttribute("aria-label")).toBe("Model and reasoning");
      expect(button("Model and reasoning").getAttribute("aria-expanded")).toBe("true");
      expect(row("Model").disabled).toBe(true);
      const calls = onConfigurationChange.mock.calls.length;
      act(() => row("Model").click());
      expect(onConfigurationChange).toHaveBeenCalledTimes(calls);
      expect(dialog()!.getAttribute("aria-label")).toBe("Model and reasoning");

      const configuration = onConfigurationChange.mock.lastCall![0];
      if (label === "Reasoning effort") expect(configuration.modelSettings.reasoningEffort).toBe("low");
      if (label === "Model") expect(configuration.model).toBe("codex:other");
      if (label === "Agent") expect(configuration.harness).toBe("claude");
      rerender({ configuration, disabled: false, working: false });
      expect(dialog()).toBe(sheet);
      expect(row("Model").disabled).toBe(false);
      expect(row(label).querySelector("small")?.textContent).toBe(option);
    }
    expect(onConfigurationChange).toHaveBeenCalledTimes(3);
    act(() => sheet!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(node.querySelector("textarea")!.value).toBe("Keep this draft");
  });

  it("still dismisses other composer sheets when the composer becomes disabled", () => {
    const { node, click, rerender } = render();
    click("Permissions: Supervised");
    rerender({ disabled: true, working: true });
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
  });

  it("closes with Escape from the input and allows Tab to enter popup navigation", () => {
    const { node, button } = render();
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    tapKeepingFocus(button("Add to message"));
    act(() => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(area);

    tapKeepingFocus(button("Add to message"));
    const rows = [...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) .mobile-sheet-row:not(:disabled)')];
    act(() => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(rows[0]);
    act(() => rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(rows.at(-1));
    act(() => rows.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(area);
  });

  it("retains the existing pointer and mouse focus protection", () => {
    const { node, button } = render();
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    pointerTapKeepingFocus(button("Add to message"));
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(area);
  });

  it("applies a permission once without losing typing focus", () => {
    const onConfigurationChange = vi.fn();
    const { node, button } = render({ onConfigurationChange });
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    const blur = vi.fn();
    area.addEventListener("blur", blur);
    tapKeepingFocus(button("Permissions: Supervised"));
    const choice = [...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="radio"]')]
      .find(element => element.textContent?.includes("Full access"))!;
    tapKeepingFocus(choice);
    expect(onConfigurationChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ runtimeMode: "full-access" }));
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(area);
    expect(blur).not.toHaveBeenCalled();
  });

  it("leaves scrolling and cancelled touches available without opening a popup", () => {
    const { node, button } = render();
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    const trigger = button("Model and reasoning");
    act(() => {
      touch("touchstart", trigger);
      expect(touch("touchmove", trigger, 40, 120).defaultPrevented).toBe(false);
      // Returning to the starting point still belongs to the scroll gesture.
      expect(touch("touchend", trigger).defaultPrevented).toBe(false);
      touch("touchstart", trigger);
      touch("touchcancel", trigger);
      expect(touch("touchend", trigger).defaultPrevented).toBe(false);
    });
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(area);
  });

  it("keeps form submission and stop working exactly once for touch actions", () => {
    const { node, button, rerender, onSend, onStop } = render();
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    tapKeepingFocus(button("Send message"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    rerender({ running: true, value: "", canStop: true });
    tapKeepingFocus(button("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(area);
  });
});
describe("mobile composer card", () => {
  it("uses delivered dock geometry while retaining queue gaps across resizing and queue changes", () => {
    const observers: { notify: (entries: ResizeObserverEntry[]) => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function (callback) {
      const observer = {
        notify: (entries: ResizeObserverEntry[]) => callback(entries, {} as ResizeObserver),
        observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
      };
      observers.push(observer);
      return observer;
    });
    const { node, rerender } = render();
    const dock = node.querySelector<HTMLElement>(".mobile-composer-dock")!;
    const form = node.querySelector("form")!;
    const dockHeight = vi.spyOn(dock, "offsetHeight", "get").mockReturnValue(196);
    const formHeight = vi.spyOn(form, "offsetHeight", "get").mockReturnValue(112);
    const top = vi.spyOn(form, "offsetTop", "get").mockReturnValue(66);
    const activeObserver = () => observers.filter(({ observe }) =>
      observe.mock.calls.some(([target, options]) => target === dock && options?.box === "border-box"),
    ).at(-1)!;
    const initialObserver = activeObserver();
    const entry = (target: Element, height: number, width = 400) => ({
      target,
      // Deliberately smaller than the border box: padding must be included.
      contentRect: { width, height: height - 26 },
      borderBoxSize: [{ blockSize: height, inlineSize: width }],
    }) as ResizeObserverEntry;
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("0px");

    rerender({ queue: createElement("div", null, "Queued message") });
    expect(initialObserver.disconnect).toHaveBeenCalledOnce();
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("66px");
    const observer = activeObserver();
    expect(observer.observe).toHaveBeenCalledWith(form, { box: "border-box" });
    const resize = (...entries: ResizeObserverEntry[]) => act(() => observer.notify(entries));
    resize(entry(dock, 196.25), entry(form, 112.25));
    dockHeight.mockClear();
    formHeight.mockClear();
    top.mockClear();

    // The textarea grows, while queue height and collapsed margins stay fixed.
    resize(entry(dock, 228.75), entry(form, 144.75));
    expect(node.style.getPropertyValue("--mobile-dock-height")).toBe("calc(229px + max(0px, var(--mobile-safe-bottom) - 8px))");
    expect(dockHeight).not.toHaveBeenCalled();
    expect(formHeight).not.toHaveBeenCalled();
    expect(top).not.toHaveBeenCalled();
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("66px");

    // A closing queue can lose only its collapsed margin after its height has
    // already reached zero. No queue border-box resize is required to catch it.
    top.mockReturnValue(58);
    resize(entry(dock, 220.75));
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("58px");
    expect(top).toHaveBeenCalledOnce();
    top.mockReturnValue(62);
    resize(entry(dock, 220.75, 360));
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("62px");
    expect(top).toHaveBeenCalledTimes(2);

    rerender({ queue: undefined });
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("0px");
    top.mockReturnValue(80);
    rerender({ queue: createElement("div", null, "New queue") });
    expect(dock.style.getPropertyValue("--mobile-dock-queue-height")).toBe("80px");
    expect(activeObserver()).not.toBe(observer);
  });

  it("preserves multiline drafts, visible controls and attachments when focus or keyboard state changes", () => {
    const uninstall = installKeyboardMotion();
    try {
      keyboard(0, 0);
      const draft = "First line\nSecond line\nThird line";
      vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(104);
      const { node, button } = render({
        value: draft,
        attachments: [{ id: "one", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 4 }],
      });
      const area = node.querySelector("textarea")!;
      const chips = node.querySelector(".mobile-composer-attachments")!;
      const outside = document.createElement("button");
      document.body.append(outside);
      act(() => area.focus());
      keyboard(300);
      act(() => outside.focus());
      keyboard(0, 240);
      expect(area.value).toBe(draft);
      expect(area.style.height).toBe("104px");
      expect(node.querySelector(".mobile-composer-attachments")).toBe(chips);
      expect(chips.closest('[aria-hidden="true"], [inert]')).toBeNull();
      expect(button("Model and reasoning").closest('[aria-hidden="true"], [inert]')).toBeNull();
      expect(button("Permissions: Supervised").closest('[aria-hidden="true"], [inert]')).toBeNull();
      act(() => area.focus());
      expect(node.querySelector("textarea")).toBe(area);
      expect(area.value).toBe(draft);
    } finally {
      uninstall();
    }
  });

  it("remeasures wrapping only when the available dock width changes", () => {
    const observers: { callback: () => void; observe: ReturnType<typeof vi.fn> }[] = [];
    vi.spyOn(globalThis, "ResizeObserver").mockImplementation(function (callback) {
      const observer = { callback: () => callback([], {} as ResizeObserver), observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      observers.push(observer);
      return observer;
    });
    const measuredWidths: string[] = [];
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
      measuredWidths.push(this.style.width);
      return this.style.width === "324px" ? 80 : 120;
    });
    const { node } = render();
    const form = node.querySelector("form")!;
    const area = node.querySelector("textarea")!;
    const dock = node.querySelector<HTMLElement>(".mobile-composer-dock")!;
    dock.style.padding = "8px 16px";
    form.style.border = "1px solid";
    const width = vi.spyOn(dock, "clientWidth", "get").mockReturnValue(394);
    const dockObservers = observers.filter((item) => item.observe.mock.calls.some(([target]) => target === dock));
    const notifyResize = () => act(() => dockObservers.forEach((item) => item.callback()));
    notifyResize();
    expect(measuredWidths).toEqual(["0px", "324px"]);
    expect(area.style.height).toBe("80px");
    notifyResize();
    expect(measuredWidths).toHaveLength(2);
    width.mockReturnValue(334);
    notifyResize();
    expect(measuredWidths).toEqual(["0px", "324px", "264px"]);
    expect(area.style.height).toBe("120px");
    expect(node.querySelectorAll("textarea:not([data-autosize-measure])")).toHaveLength(1);
  });

  it("lets sent attachments exit inertly and reverses closing when new files arrive", async () => {
    vi.useFakeTimers();
    try {
      const attachment = { id: "one", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 4 };
      const { node, rerender } = render({ attachments: [attachment] });
      rerender({ value: "", attachments: [] });
      const region = node.querySelector<HTMLElement>(".mobile-composer-attachment-region")!;
      expect(region.dataset.closing).toBe("true");
      expect(region.inert).toBe(true);
      expect(region.textContent).toContain("notes.txt");
      act(() => vi.advanceTimersByTime(60));
      rerender({ attachments: [{ ...attachment, id: "two", name: "new.txt" }] });
      expect(region.dataset.closing).toBeUndefined();
      expect(region.inert).toBe(false);
      expect(region.textContent).toContain("new.txt");
      await finishMotion();
      expect(region.textContent).toContain("new.txt");
      rerender({ attachments: [] });
      await finishMotion();
      expect(node.querySelector(".mobile-composer-attachments")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes attachment chips immediately with reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { node, rerender } = render({
      attachments: [{ id: "one", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 4 }],
    });
    rerender({ attachments: [] });
    expect(node.querySelector(".mobile-composer-attachments")).toBeNull();
  });

  it("keeps the attachment subtree when the live motion preference changes", () => {
    const { node, rerender } = render({
      attachments: [{ id: "one", name: "notes.txt", mimeType: "text/plain", kind: "file", size: 4 }],
    });
    const chips = node.querySelector(".mobile-composer-attachments");
    act(() => applyReducedMotion("on"));
    expect(node.querySelector(".mobile-composer-attachments")).toBe(chips);
    act(() => applyReducedMotion("off"));
    expect(node.querySelector(".mobile-composer-attachments")).toBe(chips);
    act(() => applyReducedMotion("on"));
    rerender({ attachments: [] });
    expect(node.querySelector(".mobile-composer-attachments")).toBeNull();
  });

  it("switches draft projects through the add menu without losing typing focus", () => {
    const { node, button, onProjectChange } = render();
    const area = node.querySelector("textarea")!;
    act(() => { area.focus(); area.setSelectionRange(5, 9); });
    tapKeepingFocus(button("Add to message"));
    tapKeepingFocus(button("Choose project"));
    const projects = [...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="radio"]')];
    tapKeepingFocus(projects.find(row => row.getAttribute("aria-checked") === "true")!);
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(node.querySelector(".mobile-composer-project")).toBeNull();
    tapKeepingFocus(button("Add to message"));
    tapKeepingFocus(button("Choose project"));
    tapKeepingFocus([...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="radio"]')]
      .find(row => row.textContent?.includes("workbench"))!);
    expect(onProjectChange).toHaveBeenCalledOnce();
    expect(onProjectChange).toHaveBeenCalledWith({ id: "two", name: "workbench", cwd: "/projects/workbench" });
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([5, 9]);
    expect(area.value).toBe("Keep this draft");
  });

  it("chooses a new conversation's workspace and hides it once the conversation exists", async () => {
    const onChange = vi.fn();
    const workspace = {
      value: { mode: "current" },
      onChange,
      loadBranches: vi.fn(async () => ({ current: "main", branches: ["main", "feature"], remotes: [] })),
      loadWorktrees: vi.fn(async () => ({
        defaultRoot: "/projects/monocode-worktrees",
        worktrees: [
          { path: "/projects/monocode", branch: "main", head: "a", isMain: true, missing: false },
          { path: "/projects/monocode-worktrees/wt-fix", branch: "fix", head: "b", isMain: false, missing: false },
        ],
      })),
    };
    const { node, button, rerender } = render({ workspace });
    const area = node.querySelector("textarea")!;
    act(() => area.focus());
    const rows = () => [...node.querySelectorAll<HTMLButtonElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="radio"]')];
    tapKeepingFocus(button("Workspace: Current checkout"));
    await act(async () => {});
    tapKeepingFocus(rows().find(row => row.textContent?.includes("New worktree"))!);
    expect(onChange).toHaveBeenLastCalledWith({ mode: "worktree", base: "main" });
    tapKeepingFocus(rows().find(row => row.textContent?.includes("Existing worktree"))!);
    await act(async () => {});
    expect(rows().map(row => row.textContent)).toEqual([expect.stringContaining("wt-fix")]);
    tapKeepingFocus(rows()[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ mode: "current", cwd: "/projects/monocode-worktrees/wt-fix", linkedWorktree: true });
    expect(document.activeElement).toBe(area);
    rerender({ workspace: { ...workspace, value: { mode: "current", cwd: "/projects/monocode-worktrees/wt-fix" } } });
    expect(button("Workspace: wt-fix")).not.toBeNull();
    rerender({ lockedAgent: true });
    expect(node.querySelector(".mobile-composer-workspace")).toBeNull();
  });

  it("keeps a locked project sheet closed even if requested externally", () => {
    const { node } = render({ lockedAgent: true, panel: "projects" });
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(node.querySelector('[aria-label="Choose project"]')).toBeNull();
  });

  it("dismisses the keyboard on an outside tap but retains it during scrolling", () => {
    const { node } = render();
    const area = node.querySelector("textarea")!;
    const transcript = document.createElement("div");
    document.body.append(transcript);
    const pointer = (type: string, y: number) =>
      act(() => {
        transcript.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 10, clientY: y }),
        );
      });
    act(() => area.focus());
    pointer("pointerdown", 100);
    pointer("pointerup", 160);
    expect(document.activeElement).toBe(area);
    pointer("pointerdown", 100);
    pointer("pointercancel", 100);
    pointer("pointerup", 100);
    expect(document.activeElement).toBe(area);
    pointer("pointerdown", 100);
    pointer("pointerup", 102);
    expect(document.activeElement).not.toBe(area);
    expect(area.value).toBe("Keep this draft");
  });

  it("sends drafts while running, restores Stop when cleared and locks model settings", () => {
    const { node, click, onSend, onStop, button, rerender } = render({ running: true, canStop: true, lockedAgent: true });
    expect(node.querySelector("textarea")!.disabled).toBe(false);
    expect(button("Model and reasoning").disabled).toBe(true);
    expect(node.querySelector('[aria-label="Stop"]')).toBeNull();
    expect(node.querySelector('[aria-label="Queue message"]')).toBeNull();
    click("Send message");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    rerender({ canSend: false });
    expect(button("Send message").disabled).toBe(true);
    expect(node.querySelector('[aria-label="Stop"]')).toBeNull();
    rerender({ value: "", canSend: false });
    expect(node.querySelector('[aria-label="Send message"]')).toBeNull();
    click("Stop");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("folds to one line for a pending question and expands when focused", async () => {
    vi.useFakeTimers();
    try {
      const onExpand = vi.fn();
      const { node, rerender } = render({ running: true, canStop: true, value: "", canSend: false, compact: true, onExpand });
      await finishMotion();
      const form = node.querySelector("form")!;
      expect(form.dataset.compact).toBe("true");
      expect(node.querySelector(".mobile-composer-context")!.hasAttribute("inert")).toBe(true);
      // Only the line's own Stop remains; the toolbar has folded away.
      expect(node.querySelectorAll('[aria-label="Stop"]')).toHaveLength(1);
      expect(node.querySelector('[aria-label="Add to message"]')).toBeNull();
      expect(node.querySelector("textarea")!.placeholder).toBe("Add to the conversation…");
      act(() => node.querySelector("textarea")!.focus());
      expect(onExpand).toHaveBeenCalledTimes(1);
      rerender({ compact: false });
      await finishMotion();
      expect(form.dataset.compact).toBeUndefined();
      expect(node.querySelectorAll('[aria-label="Stop"]')).toHaveLength(1);
      expect(node.querySelector('[aria-label="Add to message"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows model loading in the composer and keeps it synchronized with the menu", () => {
    const { node, button, click, rerender } = render({ catalogLoading: true });
    const trigger = button("Model and reasoning");
    expect(trigger.getAttribute("aria-busy")).toBe("true");
    expect(trigger.querySelector('.mobile-spin[aria-label="Loading…"]')).not.toBeNull();
    expect(trigger.textContent).toContain("Test model");
    click("Model and reasoning");
    expect(node.querySelector('.mobile-model-options .mobile-spin')).not.toBeNull();
    rerender({ catalogLoading: false });
    expect(trigger.hasAttribute("aria-busy")).toBe(false);
    expect(trigger.querySelector(".mobile-spin")).toBeNull();
    expect(node.querySelector('.mobile-model-options .mobile-spin')).toBeNull();
    expect(node.querySelector("textarea")?.value).toBe("Keep this draft");
  });

  it("keeps model controls in a sheet and closes it with Escape without losing the draft", () => {
    const { node, button, click } = render();
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    click("Model and reasoning");
    const sheet = node.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(button("Model and reasoning").getAttribute("aria-expanded")).toBe(
      "true",
    );
    act(() =>
      sheet.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(node.querySelector("textarea")!.value).toBe("Keep this draft");
    expect(document.activeElement).toBe(button("Model and reasoning"));
  });
  it("uses a send button and Ctrl/Command+Enter while plain Enter stays a newline", () => {
    const { node, click, onSend } = render();
    const area = node.querySelector("textarea")!;
    act(() =>
      area.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(lightImpact).not.toHaveBeenCalled();
    act(() =>
      area.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(lightImpact).toHaveBeenCalledTimes(1);
    act(() =>
      area.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    expect(onSend).toHaveBeenCalledTimes(1);
    click("Send message");
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(lightImpact).toHaveBeenCalledTimes(2);
  });
  it("shows Stop with an empty draft while running and locks all configuration controls", () => {
    const onPlanModeChange = vi.fn();
    const { node, button, click, onStop } = render({
      value: "",
      running: true,
      disabled: true,
      canSend: false,
      canStop: true,
      planMode: true,
      onPlanModeChange,
    });
    expect(node.querySelector('[aria-label="Send message"]')).toBeNull();
    expect(node.querySelector("textarea")!.disabled).toBe(true);
    expect(button("Model and reasoning").disabled).toBe(true);
    expect(button("Add to message").disabled).toBe(true);
    expect(button("Plan mode").disabled).toBe(true);
    click("Plan mode");
    expect(onPlanModeChange).not.toHaveBeenCalled();
    click("Stop");
    expect(onStop).toHaveBeenCalledOnce();
  });
  it("enables plan mode through the add menu and can turn it off again", () => {
    const { node, click } = render();
    click("Add to message");
    act(() =>
      node.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
    );
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).toBeNull();
    expect(node.querySelector(".mobile-composer-plan")).not.toBeNull();
    click("Plan mode");
    expect(node.querySelector('.mobile-sheet-backdrop:not([aria-hidden="true"]) [role="dialog"]')).not.toBeNull();
    expect(node.querySelector(".mobile-composer-plan")).not.toBeNull();
    click("Turn off plan mode");
    expect(node.querySelector(".mobile-composer-plan")).toBeNull();
  });
  it("keeps an existing conversation's project fixed when opening the add menu", () => {
    const { node, click, onProjectChange } = render({ lockedAgent: true });
    click("Add to message");
    expect(node.querySelector('[aria-label="Choose project"]')).toBeNull();
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(node.querySelector("textarea")!.value).toBe("Keep this draft");
  });
  it("accepts file selections and allows selecting the same file again", () => {
    const { node, onFiles } = render();
    const input = node.querySelector<HTMLInputElement>(
      'input[aria-label="Upload files"]',
    )!;
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe("");
  });
  it("reads file bytes without desktop APIs and rejects files beyond the Host limits", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(await readMobileAttachments([file])).toEqual([
      expect.objectContaining({
        name: "notes.txt",
        data: "dGV4dA==",
        size: 4,
        mimeType: "text/plain",
        kind: "file",
      }),
    ]);
    await expect(readMobileAttachments(Array(21).fill(file))).rejects.toThrow(
      "20 files",
    );
    Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
    await expect(readMobileAttachments([file])).rejects.toThrow("20 MB");
  });
});
