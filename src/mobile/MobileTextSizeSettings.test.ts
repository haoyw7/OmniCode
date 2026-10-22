// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileTextSizeSettings } from "./MobileTextSizeSettings";
import {
  applyMobileTextSize,
  loadMobileTextSize,
  normalizeMobileTextSize,
  saveMobileTextSize,
} from "./textSize";
import {
  applyFontSize,
  loadFontSize,
  saveFontSize,
} from "../features/settings/model/typography";
import { setUiLanguage } from "../shared/i18n/language";
import { devicePreferences } from "../shared/lib/persistedPreferences";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  devicePreferences.dispose();
  document.documentElement.removeAttribute("style");
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  act(() => root.render(createElement(MobileTextSizeSettings)));
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.restoreAllMocks();
});

it("adjusts via the keyboard, restores after remount, and resets the saved size", () => {
  const slider = node.querySelector('[role="slider"]')!;
  act(() => {
    slider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(slider.getAttribute("aria-valuenow")).toBe("105");
  expect(loadMobileTextSize()).toBe(105);
  expect(
    document.documentElement.style.getPropertyValue("--content-font-scale"),
  ).toBe("1.05");
  act(() => root.render(null));
  devicePreferences.dispose();
  act(() => root.render(createElement(MobileTextSizeSettings)));
  expect(node.querySelector("output")?.textContent).toBe("105%");
  act(() => node.querySelector<HTMLButtonElement>("button")!.click());
  expect(loadMobileTextSize()).toBe(100);
  expect(
    node.querySelector('[role="slider"]')?.getAttribute("aria-valuenow"),
  ).toBe("100");
});

it("preserves shared font sizes and reapplies the local multiplier after shared updates", () => {
  saveFontSize("content", 16);
  saveFontSize("code", 15);
  act(() => saveMobileTextSize(150));
  const style = document.documentElement.style;
  expect(style.getPropertyValue("--content-font-scale")).toBe("1.7143");
  expect(style.getPropertyValue("--code-font-scale")).toBe("1.875");
  expect(loadFontSize("content")).toBe(16);
  expect(loadFontSize("code")).toBe(15);
  saveFontSize("content", 18);
  applyFontSize("content", 18);
  applyMobileTextSize();
  expect(style.getPropertyValue("--content-font-scale")).toBe("1.9286");
  act(() => saveMobileTextSize(100));
  expect(style.getPropertyValue("--content-font-scale")).toBe("1.2857");
});

it("normalizes invalid values and keeps controls usable when persistence fails", () => {
  for (const value of [null, undefined, "", "bad", {}, Infinity, NaN]) {
    expect(normalizeMobileTextSize(value)).toBe(100);
  }
  expect(normalizeMobileTextSize(200)).toBe(150);
  expect(normalizeMobileTextSize(10)).toBe(80);
  expect(normalizeMobileTextSize(117)).toBe(115);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  act(() => saveMobileTextSize(120));
  expect(node.querySelector("output")?.textContent).toBe("120%");
  expect(loadMobileTextSize()).toBe(120);
});

it("localizes the slider, preview and reset action", () => {
  act(() => setUiLanguage("zh-CN"));
  expect(node.textContent).toContain("文字大小");
  expect(node.textContent).toContain("宇宙的真相是什么？");
  expect(node.querySelector("button")?.textContent).toBe("重置");
});
