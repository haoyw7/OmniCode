// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyReducedMotion } from "../../../../shared/lib/reducedMotion";
import { useSurfaceVisibility } from "../../../../shared/ui/SurfaceVisibility";
import { beginPaneResize } from "../../../../shared/lib/paneResize";
import { FileExplorerFrame } from "./FileExplorerFrame";

vi.mock("../../../source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => new Map(),
}));
vi.mock("./FileTree", () => ({
  FileTree: ({ onOpenFile }: { onOpenFile: (path: string) => void }) =>
    createElement(
      "button",
      { onClick: () => onOpenFile("/repo/a.ts") },
      "a.ts",
    ),
}));
function Preview() {
  const visible = useSurfaceVisibility();
  return createElement("textarea", {
    "aria-label": "Document",
    "data-visible": visible,
    defaultValue: "unsaved draft",
  });
}
function Fixture() {
  const [path, setPath] = useState<string>();
  return createElement(FileExplorerFrame, {
    cwd: "/repo",
    focused: true,
    hasDocument: !!path,
    activePath: path,
    onOpenFile: setPath,
    renderHeader: (leading, trailing, showDocument) =>
      createElement(
        "header",
        null,
        leading,
        trailing,
        path
          ? createElement("button", { onClick: showDocument }, "Open file tab")
          : null,
      ),
    children: createElement(Preview),
  });
}
let container: HTMLDivElement;
let root: Root;
const observers = new Set<{
  target?: Element;
  callback: ResizeObserverCallback;
}>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: { target?: Element; callback: ResizeObserverCallback };
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback };
      }
      observe(target: Element) {
        this.entry.target = target;
        observers.add(this.entry);
      }
      unobserve() {
        observers.delete(this.entry);
      }
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );
  localStorage.clear();
  applyReducedMotion("on");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  applyReducedMotion("system");
  vi.unstubAllGlobals();
});
function resizePanel(width: number) {
  act(() => {
    for (const { target, callback } of observers) {
      if (target?.classList.contains("desktop-file-explorer"))
        callback(
          [{ target, contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
    }
  });
}
function render(width = 540) {
  act(() => root.render(createElement(Fixture)));
  resizePanel(width);
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label,
  )!;
  expect(button).toBeDefined();
  act(() => button.click());
}
const tree = () =>
  container.querySelector<HTMLElement>(".desktop-file-explorer-tree")!;
const preview = () => container.querySelector<HTMLTextAreaElement>("textarea")!;

it("opens a file in place and returns to the full tree without losing the editor", () => {
  render();
  click("a.ts");
  const editor = preview();
  expect(tree().inert).toBe(true);
  expect(editor.dataset.visible).toBe("true");
  editor.value = "keep this edit";
  click("Back to file tree");
  expect(tree().inert).toBe(false);
  expect(editor.dataset.visible).toBe("false");
  click("a.ts");
  expect(tree().inert).toBe(true);
  expect(preview()).toBe(editor);
  expect(editor.value).toBe("keep this edit");
});

it("allows the active file tab to return from the tree to the same document", () => {
  render();
  click("a.ts");
  click("Back to file tree");
  click("Open file tab");
  expect(tree().inert).toBe(true);
  expect(preview().dataset.visible).toBe("true");
});

it("adapts to the panel width without a maximize action and preserves the editor", () => {
  render(1000);
  click("a.ts");
  const editor = preview();
  expect(tree().inert).toBe(false);
  expect(editor.dataset.visible).toBe("true");
  resizePanel(540);
  expect(tree().inert).toBe(true);
  expect(preview()).toBe(editor);
  resizePanel(1000);
  expect(tree().inert).toBe(false);
  expect(preview()).toBe(editor);
});


it("caches responsive width during a drag and switches layout only after release", () => {
  render(900);
  click("a.ts");
  expect(container.querySelector<HTMLElement>('[aria-label="Resize file tree"]')!.hidden).toBe(false);
  const finish = beginPaneResize();
  try {
    resizePanel(600);
    expect(container.querySelector<HTMLElement>('[aria-label="Resize file tree"]')!.hidden).toBe(false);
  } finally {
    act(() => finish());
  }
  expect(container.querySelector<HTMLElement>('[aria-label="Resize file tree"]')!.hidden).toBe(true);
  expect(preview().dataset.visible).toBe("true");
});
