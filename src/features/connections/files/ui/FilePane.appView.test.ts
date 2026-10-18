// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newAppViewWorkspaceTab } from "../../../workspace/model/layout";
import { AppViewRendererContext } from "../../../workspace/ui/AppViewHost";
import { FilePane } from "./FilePane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FilePane app views", () => {
  it("renders an app view through the context only after its workspace activates", () => {
    const renderer = vi.fn((kind, active) => createElement("div", { "data-app": kind }, String(active)));
    const noop = () => {};
    const props: ComponentProps<typeof FilePane> = {
      pane: newAppViewWorkspaceTab("notes").editorPanes[0],
      focused: true,
      visible: false,
      showTabs: false,
      dirtyFileIds: new Set(),
      fileErrorCounts: new Map(),
      sessions: [],
      onFocus: noop,
      onSelectFile: noop,
      onCloseFile: noop,
      onCloseOtherFiles: noop,
      onDirtyChange: noop,
      onErrorCountChange: noop,
      onReorderFiles: noop,
      onOpenFile: noop,
      onUpdatePlan: noop,
      onBuildPlan: noop,
    };
    const renderPane = (patch: Partial<ComponentProps<typeof FilePane>>) => act(() => root.render(createElement(
      AppViewRendererContext.Provider,
      { value: renderer },
      createElement(FilePane, { ...props, ...patch }),
    )));
    renderPane({});
    expect(renderer).not.toHaveBeenCalled();
    renderPane({ visible: true });
    expect(renderer).toHaveBeenLastCalledWith("notes", true);
    const view = container.querySelector('[data-app="notes"]');
    renderPane({ visible: false });
    expect(renderer).toHaveBeenLastCalledWith("notes", false);
    expect(container.querySelector('[data-app="notes"]')).toBe(view);
  });
});
