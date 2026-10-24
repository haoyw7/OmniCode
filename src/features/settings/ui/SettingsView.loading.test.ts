// @vitest-environment happy-dom
import { act, createElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsView, preloadSettingsSection } from "../../../app/ui/SettingsView";
import * as scrolling from "../../../shared/lib/scrollWithin";
import { refreshUiLanguage, UI_LANGUAGE_KEY } from "../../../shared/i18n/language";

const loading = vi.hoisted(() => {
  let resolve!: () => void;
  const pending = new Promise<void>((ready) => { resolve = ready; });
  return { pending, resolve, appearance: vi.fn() };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(), isTauri: () => false, convertFileSrc: (path: string) => path,
}));
vi.mock("../../../shared/motion/useMotionPreference", () => ({ useMotionPreference: () => true }));
vi.mock("./pages/GeneralPage", () => ({
  GeneralPage: () => createElement("div", { "data-setting-id": "ui-language" }, "General controls"),
}));
vi.mock("./pages/appearance/AppearancePage", async () => {
  loading.appearance();
  await loading.pending;
  return {
    AppearancePage: () => createElement("div", {
      id: "setting-theme", "data-setting-id": "theme",
    }, "Appearance controls"),
  };
});

it("keeps settings interactive during page loading and reveals a searched setting after it loads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(UI_LANGUAGE_KEY, "en");
  refreshUiLanguage();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = vi.spyOn(scrolling, "scrollWithin");
  const noop = () => {};
  const navigation = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("nav button")]
    .find((button) => button.textContent === label)!;
  try {
    await preloadSettingsSection("general");
    await act(async () => root.render(createElement(Suspense, { fallback: "Loading page" },
      createElement(SettingsView, {
        section: "general", cwd: "", sessions: [], onClose: noop,
        onOpenSession: noop, onArchiveSession: noop, onDeleteSession: noop,
        onOpenWhatsNew: noop,
      }),
    )));
    expect(container.textContent).toContain("General controls");
    expect(loading.appearance).not.toHaveBeenCalled();

    await act(async () => navigation("Appearance").click());
    await vi.waitFor(() => expect(loading.appearance).toHaveBeenCalledOnce());
    expect(container.textContent).toContain("General controls");
    expect(container.textContent).not.toContain("Loading page");

    // Reversing a pending navigation keeps the current controls usable.
    await act(async () => navigation("General").click());
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search settings"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "theme");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const result = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent === "ThemeAppearance")!;
    expect(result).toBeDefined();
    await act(async () => result.click());
    expect(container.textContent).toContain("General controls");
    expect(scroll).not.toHaveBeenCalled();

    await act(async () => {
      loading.resolve();
      await preloadSettingsSection("appearance");
    });
    expect(container.textContent).toContain("Appearance controls");
    expect(navigation("Appearance").getAttribute("aria-current")).toBe("true");
    expect(scroll).toHaveBeenCalledWith(container.querySelector("#setting-theme"), "center");
  } finally {
    loading.resolve();
    await act(async () => root.unmount());
    container.remove();
    scroll.mockRestore();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
