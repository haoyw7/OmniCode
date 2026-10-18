// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SHARED_PREFERENCES_CHANGED } from "../../settings/model/sharedPreferences";
const mocks = vi.hoisted(() => ({ shortcut: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../../integrations/harness/core/availability", () => ({ probeHarnessAvailability: vi.fn() }));
vi.mock("../../../integrations/harness/core/registry", () => ({ refreshHarnessCatalogs: vi.fn() }));
vi.mock("../model/prepareQuickComposer", () => ({ prepareQuickComposerWhenIdle: () => () => {} }));
vi.mock("../model/quickComposer", () => ({
  quickComposerSupported: () => true, setQuickComposerShortcut: mocks.shortcut,
  isHarnessId: () => false, parseQuickLaunch: () => null, liveQuickCatalog: () => [],
  QUICK_COMPOSER_CATALOG_EVENT: "catalog", QUICK_COMPOSER_CATALOG_REQUEST_EVENT: "catalog-request", QUICK_COMPOSER_LAUNCH_EVENT: "launch",
}));
import { useQuickComposerLaunches } from "./useQuickComposerLaunches";
function Harness() { useQuickComposerLaunches(async () => {}); return null; }
it("applies incoming enabled and shortcut changes once and stops when the window unmounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    mocks.shortcut.mockClear();
    localStorage.setItem("monocode.quickComposerEnabled", "1");
    localStorage.setItem("monocode.quickComposerShortcut", "Control+Shift+KeyK");
    window.dispatchEvent(new Event(SHARED_PREFERENCES_CHANGED));
    expect(mocks.shortcut).toHaveBeenCalledExactlyOnceWith(true, "Control+Shift+KeyK");
    window.dispatchEvent(new Event(SHARED_PREFERENCES_CHANGED));
    expect(mocks.shortcut).toHaveBeenCalledOnce();
    localStorage.setItem("monocode.quickComposerEnabled", "0");
    window.dispatchEvent(new Event(SHARED_PREFERENCES_CHANGED));
    expect(mocks.shortcut).toHaveBeenLastCalledWith(false, "Control+Shift+KeyK");
    await act(async () => root.unmount());
    mocks.shortcut.mockClear();
    window.dispatchEvent(new Event(SHARED_PREFERENCES_CHANGED));
    expect(mocks.shortcut).not.toHaveBeenCalled();
  } finally { localStorage.clear(); vi.unstubAllGlobals(); }
});
