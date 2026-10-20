// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useColorScheme } from "./useColorScheme";

const preference = vi.hoisted(() => ({ value: "dark" as "light" | "dark" }));
vi.mock("../../features/settings/model/appearance", () => ({
  loadThemePreference: () => preference.value,
  resolveColorScheme: (value: string) => value,
  SCHEME_CHANGE_EVENT: "omnicode:schemechange",
}));

let root: Root;
let container: HTMLDivElement;
function Probe() {
  return createElement("span", null, useColorScheme());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preference.value = "dark";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.documentElement.dataset.skin;
  delete document.documentElement.dataset.mobileSkin;
  document.documentElement.classList.remove("theme-light");
  vi.unstubAllGlobals();
});

it.each([
  ["lagoon", "light", "dark"],
  ["foundry", "dark", "light"],
] as const)("starts newly mounted viewers in the applied %s skin", (skin, scheme, stored) => {
  preference.value = stored;
  document.documentElement.dataset.skin = skin;
  document.documentElement.classList.toggle("theme-light", scheme === "light");
  act(() => root.render(createElement(Probe)));
  expect(container.textContent).toBe(scheme);
  const next = scheme === "light" ? "dark" : "light";
  act(() => window.dispatchEvent(new CustomEvent("omnicode:schemechange", { detail: next })));
  expect(container.textContent).toBe(next);
});

it("keeps the preference fallback before a desktop skin is applied", () => {
  preference.value = "light";
  act(() => root.render(createElement(Probe)));
  expect(container.textContent).toBe("light");
});

it.each([
  ["linen", "light", "dark"],
  ["graphite", "dark", "light"],
  ["daylight", "light", "dark"],
  ["midnight", "dark", "light"],
] as const)("starts newly mounted mobile viewers in the applied %s skin", (skin, scheme, stored) => {
  preference.value = stored;
  document.documentElement.dataset.mobileSkin = skin;
  document.documentElement.classList.toggle("theme-light", scheme === "light");
  act(() => root.render(createElement(Probe)));
  expect(container.textContent).toBe(scheme);
  const next = scheme === "light" ? "dark" : "light";
  act(() => {
    document.documentElement.classList.toggle("theme-light", next === "light");
    window.dispatchEvent(new CustomEvent("omnicode:schemechange", { detail: next }));
  });
  expect(container.textContent).toBe(next);
});
