// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  sync: vi.fn(),
  import: vi.fn(),
  auto: vi.fn(),
  desktop: true,
  state: {
    files: [
      {
        provider: "codex",
        providerSessionId: "c-id",
        cwd: "/codex-project",
        path: "/codex.jsonl",
        revision: "1",
        modifiedAt: 100,
      },
      {
        provider: "pi",
        providerSessionId: "p-id",
        cwd: "/pi-project",
        path: "/pi.jsonl",
        revision: "1",
        modifiedAt: 100,
      },
    ],
    warnings: [],
    bound: new Set<string>(),
    importedCount: 0,
    autoSync: true,
    busy: false,
    error: undefined as string | undefined,
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.desktop }));
vi.mock("../../sessions/data/nativeSessions", () => ({
  discoverNativeSessions: mocks.discover,
  syncNativeSessions: mocks.sync,
  importNativeSession: mocks.import,
  importNativeSessions: async (
    files: unknown[],
    options: {
      onImported?: (file: unknown, id: string) => void;
      onProgress?: (progress: { done: number; total: number; failed: number }) => void;
    },
  ) => {
    let done = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const id = await mocks.import(file);
        if (id) options.onImported?.(file, id);
        else failed++;
      } catch {
        failed++;
      }
      done++;
      options.onProgress?.({ done, total: files.length, failed });
    }
    return { done, total: files.length, failed };
  },
  nativeSessionSnapshot: () => mocks.state,
  subscribeNativeSessions: () => () => {},
  setNativeAutoSync: mocks.auto,
}));
import { NativeSessionsPanel } from "./NativeSessionsPanel";
import { setUiLanguage } from "../../../shared/i18n/language";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.desktop = true;
  mocks.state.error = undefined;
  mocks.state.autoSync = true;
  vi.clearAllMocks();
  mocks.discover.mockResolvedValue([]);
  mocks.import.mockResolvedValue("existing-id");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setUiLanguage("en");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});
const buttons = (text: string) =>
  [...container.querySelectorAll("button")].filter(
    (node) => node.textContent === text,
  );
it("lists every app, expands one app's conversations, imports and opens the result", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(createElement(NativeSessionsPanel, { onOpenSession: open })),
  );
  expect(mocks.discover).toHaveBeenCalledOnce();
  for (const name of ["Claude Code", "Codex", "Pi", "omp", "OpenCode"])
    expect(container.textContent).toContain(name);
  // Apps without detected conversations cannot be expanded.
  const claude = container.querySelector('[data-native-provider="claude"] button')!;
  expect(claude.hasAttribute("disabled")).toBe(true);
  expect(container.textContent).not.toContain("/pi-project");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-native-provider="pi"] button')!.click(),
  );
  expect(container.textContent).toContain("/pi-project");
  expect(container.textContent).not.toContain("/codex-project");
  const row = [...container.querySelectorAll('[data-native-provider="pi"] button')].find(
    (node) => node.textContent === "Import" && node.getAttribute("aria-expanded") === null,
  )!;
  await act(async () => (row as HTMLButtonElement).click());
  expect(mocks.import).toHaveBeenCalledWith(mocks.state.files[1]);
  expect(open).toHaveBeenCalledWith("existing-id");
  expect(buttons("Open").length).toBe(1);
});
it("switches to Chinese without changing native provider values and persists the sync preference", async () => {
  await act(async () => root.render(createElement(NativeSessionsPanel)));
  await act(async () => setUiLanguage("zh-CN"));
  expect(container.textContent).toContain("从其他 AI 应用导入");
  expect(container.textContent).toContain("Codex");
  expect(buttons("立即同步")[0]?.hasAttribute("disabled")).toBe(true);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
  );
  expect(mocks.auto).toHaveBeenCalledWith(false);
  // The panel shows the Host setting from the shared listing state.
  mocks.state.autoSync = false;
  await act(async () => root.render(createElement(NativeSessionsPanel, {})));
  expect(container.textContent).toContain("同步已暂停");
});
it("does not attempt unsupported browser import", async () => {
  mocks.desktop = false;
  await act(async () => root.render(createElement(NativeSessionsPanel)));
  expect(mocks.discover).not.toHaveBeenCalled();
  expect(container.textContent).toContain("desktop app");
});
it("imports every not-yet-imported conversation, continues past failures and reports the result", async () => {
  const open = vi.fn();
  mocks.state.bound = new Set(["codex:c-id"]);
  mocks.import.mockReset();
  mocks.import.mockRejectedValueOnce(new Error("Native session has no user messages yet"));
  await act(async () =>
    root.render(createElement(NativeSessionsPanel, { onOpenSession: open })),
  );
  const all = buttons("Import all (1)")[0];
  expect(all).toBeDefined();
  await act(async () => all.click());
  expect(mocks.import).toHaveBeenCalledTimes(1);
  expect(mocks.import).toHaveBeenCalledWith(mocks.state.files[1]);
  const result = document.querySelector("[data-status-toast-host] [role=alert]");
  expect(result?.textContent).toContain("Imported 0 conversations; 1 could not be imported.");
  // Bulk import never opens sessions one by one.
  expect(open).not.toHaveBeenCalled();
  mocks.state.bound = new Set();
});
