// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileHapticSettings } from "./MobileHapticSettings";
import { loadHapticPreferences, saveHapticPreferences } from "./hapticPreferences";
import { setUiLanguage } from "../shared/i18n/language";
import { previewOutputHaptics } from "./haptics";

vi.mock("./haptics", () => ({ previewOutputHaptics: vi.fn() }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.mocked(previewOutputHaptics).mockReset();
  localStorage.clear(); setUiLanguage("en");
  saveHapticPreferences({ interactions: true, output: true, strength: "gentle" });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  act(() => root.render(createElement(MobileHapticSettings)));
});

it("shows localized native failure details after trying output vibration", () => {
  act(() => setUiLanguage("zh-CN"));
  vi.mocked(previewOutputHaptics).mockImplementation((report) => {
    report?.("system-disabled");
    return vi.fn();
  });
  const preview = [...node.querySelectorAll("button")].find((button) => button.textContent === "体验输出震动")!;
  act(() => preview.click());
  expect(node.querySelector('[role="status"]')?.textContent).toContain("系统设置中的触感震动已关闭");
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.restoreAllMocks(); });

it("persists independent device switches and updates the visible controls immediately", () => {
  const switches = node.querySelectorAll<HTMLButtonElement>('[role="switch"]');
  act(() => switches[0].click());
  expect(loadHapticPreferences()).toEqual({ interactions: false, output: true, strength: "gentle" });
  expect(switches[0].getAttribute("aria-checked")).toBe("false");
  act(() => switches[1].click());
  expect(loadHapticPreferences().output).toBe(false);
  expect(node.querySelector<HTMLButtonElement>("#output-haptic-strength")!.disabled).toBe(true);
  act(() => saveHapticPreferences({ interactions: true, output: true, strength: "standard" }));
  expect(switches[0].getAttribute("aria-checked")).toBe("true");
  expect(switches[1].getAttribute("aria-checked")).toBe("true");
  expect(node.querySelector("#output-haptic-strength")!.textContent).toContain("Standard");
});

it("localizes the controls and stops the preview on leaving settings", () => {
  const stop = vi.fn(); vi.mocked(previewOutputHaptics).mockReturnValue(stop);
  act(() => setUiLanguage("zh-CN"));
  expect(node.textContent).toContain("AI 输出震动");
  const preview = [...node.querySelectorAll("button")].find((button) => button.textContent === "体验输出震动")!;
  act(() => preview.click());
  expect(previewOutputHaptics).toHaveBeenCalledOnce();
  act(() => root.render(null));
  expect(stop).toHaveBeenCalledOnce();
});
