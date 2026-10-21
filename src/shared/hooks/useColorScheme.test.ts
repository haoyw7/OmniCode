// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, useTheme } from "next-themes";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useColorScheme } from "./useColorScheme";
import { themeConfig } from "../theme/themeConfig";

let root: Root;
let container: HTMLDivElement;
let setTheme: ReturnType<typeof useTheme>["setTheme"];
function Probe() {
  setTheme = useTheme().setTheme;
  return createElement("span", null, useColorScheme());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  document.documentElement.className = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["light", "dark"])("follows next-themes %s and later changes", async scheme => {
  await act(async () => root.render(createElement(ThemeProvider, { ...themeConfig, defaultTheme: scheme }, createElement(Probe))));
  expect(container.querySelector("span")!.textContent).toBe(scheme);
  const next = scheme === "light" ? "dark" : "light";
  await act(async () => setTheme(next));
  expect(container.querySelector("span")!.textContent).toBe(next);
  expect(document.documentElement.classList.contains(`theme-${next}`)).toBe(true);
  expect(document.documentElement.classList.contains(`theme-${scheme}`)).toBe(false);
});

it.each(["light", "dark"])("uses a skin's forced %s scheme over the preference", async forcedTheme => {
  const stored = forcedTheme === "light" ? "dark" : "light";
  localStorage.setItem("theme", stored);
  await act(async () => root.render(createElement(ThemeProvider, { ...themeConfig, forcedTheme }, createElement(Probe))));
  expect(container.querySelector("span")!.textContent).toBe(forcedTheme);
  expect(localStorage.getItem("theme")).toBe(stored);
});

it("resolves system mode and receives cross-window changes", async () => {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = { matches: false, addListener: (fn: (event: { matches: boolean }) => void) => listeners.add(fn), removeListener: (fn: (event: { matches: boolean }) => void) => listeners.delete(fn) };
  vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);
  await act(async () => root.render(createElement(ThemeProvider, { ...themeConfig, defaultTheme: "system" }, createElement(Probe))));
  expect(container.querySelector("span")!.textContent).toBe("light");
  await act(async () => {
    media.matches = true;
    for (const listener of [...listeners]) listener(media);
  });
  expect(container.querySelector("span")!.textContent).toBe("dark");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "light" })));
  expect(container.querySelector("span")!.textContent).toBe("light");
});
