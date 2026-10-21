// @vitest-environment happy-dom
import { queryClient } from "../../../../shared/lib/queryClient";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveShowExcludedFiles } from "../../../settings/model/appearance";
import {
  listCachedDir,
  forgetDir,
  notifyDirsChanged,
  refreshDir,
  saveExpanded,
  saveSelected,
} from "../model/fileTree";
import type { FsEntry } from "../../../../platform/tauri/fs";
import { DragDropProvider } from "../../../../shared/ui/primitives/Sortable";
import { mockDragOverlayGeometry } from "../../../../../tests/helpers/dndGeometry";
import { dndPointer } from "../../../../../tests/helpers/dndEvents";
import { FileTree } from "./FileTree";

const { iconRender, directories, clipboardFiles, copied, dragDrop } =
  vi.hoisted(() => ({
    iconRender: vi.fn(),
    directories: new Map<string, FsEntry[] | Promise<FsEntry[]>>(),
    clipboardFiles: [] as string[],
    copied: [] as { from: string; destParent: string }[],
    dragDrop: {
      handler: null as null | ((event: { payload: unknown }) => void),
    },
  }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, string>) => {
    if (command === "list_dir") return directories.get(args.path) ?? [];
    if (command === "clipboard_file_paths") return [...clipboardFiles];
    if (command === "copy_path") {
      copied.push({ from: args.from, destParent: args.destParent });
      return `${args.destParent}/${args.from.split("/").pop()}`;
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (fn: (event: { payload: unknown }) => void) => {
      dragDrop.handler = fn;
      return () => {
        dragDrop.handler = null;
      };
    },
  }),
}));

// Count row renders independently of FileTypeIcon's own memoization.
vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => {
    iconRender(name);
    return createElement("span", { "data-icon": name });
  },
}));

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

function file(name: string, ignored = false): FsEntry {
  return { name, path: `${cwd}/${name}`, isDir: false, ignored };
}

function folder(name: string, ignored = false): FsEntry {
  return { name, path: `${cwd}/${name}`, isDir: true, ignored };
}

function pressPaste(el: HTMLElement) {
  return act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }),
    );
  });
}

function press(el: HTMLElement, init: KeyboardEventInit) {
  return act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

function nativeDrop(paths: string[]) {
  return act(async () => {
    dragDrop.handler!({
      payload: { type: "drop", paths, position: { x: 10, y: 10 } },
    });
  });
}

function render(tick = 0, hidden = false) {
  root.render(
    createElement(
      "div",
      { hidden, "data-tick": tick },
      createElement(DragDropProvider, { children: createElement(FileTree, props) }),
    ),
  );
}

function row(name: string): HTMLButtonElement {
  return container.querySelector(`[role="treeitem"][title="${cwd}/${name}"]`)!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/project-${++project}`;
  props = { cwd, onOpenFile: vi.fn() };
  directories.set(cwd, [file("first.ts")]);
  await listCachedDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  queryClient.clear();
  act(() => root.unmount());
  if (vi.isFakeTimers()) act(() => vi.advanceTimersByTime(60));
  else await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  container.remove();
  localStorage.removeItem("omnicode.showExcludedFiles");
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clipboardFiles.length = 0;
  copied.length = 0;
});

describe("FileTree render isolation", () => {
  it("uses a worktree branch as the explorer root identity", async () => {
    props = { ...props, rootLabel: "mc/update-readme-tests" };

    await act(async () => render());

    const rootButton = container.querySelector<HTMLButtonElement>(
      `button[title="${cwd}"]`,
    )!;
    expect(rootButton.textContent).toContain("mc/update-readme-tests");
    expect(rootButton.lastElementChild?.className).toContain("uppercase");
    expect(
      container.querySelector('[role="tree"]')?.getAttribute("aria-label"),
    ).toBe("mc/update-readme-tests files");
  });

  it("keeps room for descenders in truncated file names", async () => {
    await act(async () => render());
    expect(row("first.ts").lastElementChild?.className).toContain(
      "leading-label",
    );
  });

  it.each([false, true])(
    "skips unchanged rows on parent updates (hidden=%s)",
    async (hidden) => {
      await act(async () => render(0, hidden));
      expect(row("first.ts")).not.toBeNull();
      iconRender.mockClear();

      for (let tick = 1; tick <= 20; tick++) act(() => render(tick, hidden));

      expect(iconRender.mock.calls.length).toBe(0);
    },
  );

  it("still updates Git decorations and uses a changed navigation callback", async () => {
    await act(async () => render());
    const onOpenFile = vi.fn();
    props = {
      ...props,
      onOpenFile,
      gitStatuses: {
        files: new Map([[`${cwd}/first.ts`, "modified"]]),
        dirs: new Map(),
      },
    };
    act(() => render(1));
    expect(row("first.ts").querySelector(".text-warning")).not.toBeNull();
    act(() => row("first.ts").click());
    expect(onOpenFile).toHaveBeenCalledWith(`${cwd}/first.ts`, undefined, {
      exact: true,
    });
  });

  it("still expands folders and refreshes rows after filesystem changes", async () => {
    saveExpanded(cwd, new Set());
    await act(async () => render());
    expect(row("first.ts")).toBeNull();
    const expand = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    await act(async () => expand.click());
    expect(row("first.ts")).not.toBeNull();

    vi.useFakeTimers();
    directories.set(cwd, [file("added.ts")]);
    await act(async () => {
      notifyDirsChanged();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(row("added.ts")).not.toBeNull();
    expect(row("first.ts").closest("[inert]")).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(row("first.ts")).toBeNull();
  });

  it.each(["root", "folder"])(
    "keeps %s children inert during closing and supports rapid reopening",
    async (target) => {
      vi.useFakeTimers();
      directories.set(cwd, [folder("docs")]);
      directories.set(`${cwd}/docs`, [
        { name: "nested.ts", path: `${cwd}/docs/nested.ts`, isDir: false },
      ]);
      await refreshDir(cwd);
      saveExpanded(cwd, new Set([cwd, `${cwd}/docs`]));
      await act(async () => render());
      const nested = row("docs/nested.ts");
      const toggle =
        target === "root"
          ? container.querySelector<HTMLButtonElement>("[data-explorer-root]")!
          : row("docs");

      act(() => toggle.click());
      expect(row("docs/nested.ts")).toBe(nested);
      expect(
        nested.closest('[data-fold-state="closing"]')?.hasAttribute("inert"),
      ).toBe(true);

      act(() => toggle.click());
      expect(row("docs/nested.ts")).toBe(nested);
      expect(nested.closest("[inert]")).toBeNull();
      expect(nested.closest('[data-fold-state="opening"]')).not.toBeNull();

      act(() => toggle.click());
      await act(async () => vi.advanceTimersByTimeAsync(400));
      expect(row("docs/nested.ts")).toBeNull();
    },
  );
});

describe("FileTree asynchronous expansion", () => {
  it.each(["root", "folder"])("waits for %s contents before starting the expansion", async (target) => {
    vi.useFakeTimers();
    let resolve!: (entries: FsEntry[]) => void;
    const pending = new Promise<FsEntry[]>((done) => { resolve = done; });
    const path = target === "root" ? cwd : `${cwd}/docs`;
    if (target === "root") {
      forgetDir(cwd);
    } else {
      directories.set(cwd, [folder("docs")]);
      await refreshDir(cwd);
    }
    directories.set(path, pending);
    await act(async () => render());
    const toggle = target === "root"
      ? container.querySelector<HTMLButtonElement>("[data-explorer-root]")!
      : row("docs");
    if (target === "folder") await act(async () => toggle.click());
    const group = target === "root"
      ? container.querySelector('[role="tree"]')!
      : toggle.parentElement!;

    expect(toggle.getAttribute("aria-busy")).toBe("true");
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(group.querySelector(".zen-fold-item")).toBeNull();

    await act(async () => resolve([
      { name: "loaded.ts", path: `${path}/loaded.ts`, isDir: false },
    ]));
    expect(toggle.hasAttribute("aria-busy")).toBe(false);
    const loaded = row(target === "root" ? "loaded.ts" : "docs/loaded.ts");
    expect(loaded.closest('[data-fold-state="opening"]')).not.toBeNull();
    expect(row(target === "root" ? "loaded.ts" : "docs/loaded.ts")).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(loaded.closest(".zen-fold-item")?.getAttribute("data-fold-state")).toBe("open");
  });

  it("does not reopen after a pending load is cancelled, and reuses the loaded cache", async () => {
    let resolve!: (entries: FsEntry[]) => void;
    directories.set(cwd, [folder("docs")]);
    directories.set(`${cwd}/docs`, new Promise((done) => { resolve = done; }));
    await refreshDir(cwd);
    await act(async () => render());
    const toggle = row("docs");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    await act(async () => toggle.click());
    await act(async () => resolve([
      { name: "loaded.ts", path: `${cwd}/docs/loaded.ts`, isDir: false },
    ]));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-busy")).toBe(false);
    expect(row("docs/loaded.ts")).toBeNull();

    await act(async () => toggle.click());
    expect(row("docs/loaded.ts")).not.toBeNull();
    expect(toggle.hasAttribute("aria-busy")).toBe(false);
  });

  it("shows directory errors and clears the loading indicator", async () => {
    let reject!: (reason: Error) => void;
    directories.set(cwd, [folder("docs")]);
    directories.set(`${cwd}/docs`, new Promise((_resolve, fail) => { reject = fail; }));
    await refreshDir(cwd);
    await act(async () => render());
    const toggle = row("docs");
    await act(async () => toggle.click());
    await act(async () => reject(new Error("Cannot read directory")));
    expect(toggle.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector('[role="tree"]')?.textContent).toContain("Cannot read directory");
  });
});

describe("FileTree excluded files", () => {
  it("hides ignored entries by default and follows the setting", async () => {
    directories.set(cwd, [
      folder("dist", true),
      folder("src"),
      file("first.ts"),
      file("debug.log", true),
    ]);
    await refreshDir(cwd);
    await act(async () => render());

    expect(row("src")).not.toBeNull();
    expect(row("first.ts")).not.toBeNull();
    expect(row("dist")).toBeNull();
    expect(row("debug.log")).toBeNull();

    act(() => saveShowExcludedFiles(true));
    expect(row("dist")).not.toBeNull();
    expect(row("debug.log")).not.toBeNull();

    act(() => saveShowExcludedFiles(false));
    expect(row("dist").closest("[inert]")).not.toBeNull();
    await act(async () => new Promise(resolve => setTimeout(resolve, 400)));
    expect(row("dist")).toBeNull();
    expect(row("debug.log")).toBeNull();
    expect(row("first.ts")).not.toBeNull();
  });
});

describe("FileTree accepts files from outside the tree", () => {
  beforeEach(async () => {
    directories.set(cwd, [folder("docs"), file("first.ts")]);
    directories.set(`${cwd}/docs`, []);
    await refreshDir(cwd);
    await listCachedDir(`${cwd}/docs`);
  });

  it("pastes files from the system clipboard into the selected folder", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt", "/Users/me/Desktop/b.txt");
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await pressPaste(row("docs"));
    expect(copied).toEqual([
      { from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` },
      { from: "/Users/me/Desktop/b.txt", destParent: `${cwd}/docs` },
    ]);
  });

  it("pastes into the parent folder when a file is selected", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt");
    saveSelected(cwd, `${cwd}/first.ts`);
    await act(async () => render());
    await pressPaste(row("first.ts"));
    expect(copied).toEqual([
      { from: "/Users/me/Desktop/a.txt", destParent: cwd },
    ]);
  });

  it("pastes on a non-Latin layout", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt");
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await press(row("docs"), { key: "м", code: "KeyV", metaKey: true });
    expect(copied).toEqual([
      { from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` },
    ]);
  });

  it("does nothing on paste when the clipboard holds no files", async () => {
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await pressPaste(row("docs"));
    expect(copied).toEqual([]);
  });

  it("does not read the clipboard when the context menu opens", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await act(async () => render());
    await act(async () => {
      row("docs").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    expect(vi.mocked(invoke).mock.calls.map((c) => c[0])).not.toContain(
      "clipboard_file_paths",
    );
  });

  it("copies a native file drop into the hovered folder", async () => {
    await act(async () => render());
    expect(dragDrop.handler).not.toBeNull();
    const target = row("docs");
    vi.stubGlobal("devicePixelRatio", 1);
    document.elementFromPoint = () => target;
    await act(async () => {
      dragDrop.handler!({
        payload: { type: "over", position: { x: 10, y: 10 } },
      });
    });
    expect(target.className).toContain("bg-selection");
    await nativeDrop(["/Users/me/Desktop/a.txt"]);
    expect(copied).toEqual([
      { from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` },
    ]);
    expect(target.className).not.toContain("bg-selection");
  });

  it("ignores a native drop outside the tree", async () => {
    await act(async () => render());
    document.elementFromPoint = () => document.body;
    await nativeDrop(["/Users/me/Desktop/a.txt"]);
    expect(copied).toEqual([]);
  });
});

describe("FileTree copies paths", () => {
  beforeEach(async () => {
    saveSelected(cwd, `${cwd}/first.ts`);
    await navigator.clipboard.writeText("before");
    await act(async () => render());
  });

  it("copies the selected path on Mod+Shift+C", async () => {
    await press(row("first.ts"), { key: "C", metaKey: true, shiftKey: true });
    expect(await navigator.clipboard.readText()).toBe(`${cwd}/first.ts`);
  });

  it("copies the project root path from the root row", async () => {
    const rootRow = container.querySelector<HTMLButtonElement>(
      "[data-explorer-root]",
    );
    if (!rootRow) throw new Error("Root row not rendered");
    await act(async () => rootRow.click());
    await press(rootRow, { key: "C", metaKey: true, shiftKey: true });
    expect(await navigator.clipboard.readText()).toBe(cwd);
  });

  it("copies the selected path on a non-Latin layout", async () => {
    await press(row("first.ts"), {
      key: "С",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
    });
    expect(await navigator.clipboard.readText()).toBe(`${cwd}/first.ts`);
  });

  it("matches the typed Latin letter, not the physical key", async () => {
    // Dvorak types "j" on the physical C key.
    await press(row("first.ts"), {
      key: "J",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
    });
    expect(await navigator.clipboard.readText()).toBe("before");
  });
});

describe("FileTree starts Explorer file drags", () => {
  beforeEach(async () => {
    directories.set(cwd, [folder("docs"), file("first.ts")]);
    await refreshDir(cwd);
  });

  it("uses an overlay for files, cancels without opening, and keeps folders out of file drags", async () => {
    mockDragOverlayGeometry();
    await act(async () => render());
    const fileRow = row("first.ts"), folderRow = row("docs");
    fileRow.getBoundingClientRect = () => new DOMRect(0, 0, 200, 30);
    dndPointer(fileRow, "pointerdown", { clientX: 10, clientY: 10 });
    dndPointer(document, "pointermove", { clientX: 40, clientY: 40 });
    expect(document.querySelector(".sortable-overlay")?.textContent).toContain("first.ts");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })));
    expect(fileRow.hasAttribute("data-explorer-dragging")).toBe(false);
    act(() => fileRow.click());
    expect(props.onOpenFile).not.toHaveBeenCalled();
    await act(async () => new Promise(resolve => setTimeout(resolve, 60)));
    dndPointer(folderRow, "pointerdown", { clientX: 10, clientY: 10 });
    dndPointer(document, "pointermove", { clientX: 40, clientY: 40 });
    dndPointer(document, "pointerup", { clientX: 40, clientY: 40 });
    expect(document.querySelector(".sortable-overlay")?.textContent ?? "").not.toContain("docs");
  });

});

describe("FileTree keyboard navigation", () => {
  it("keeps the create input mounted after a large directory's folder rows", async () => {
    directories.set(cwd, [folder("src")]);
    directories.set(`${cwd}/src`, Array.from({ length: 300 }, (_, index) => ({ name: `dir-${index}`, path: `${cwd}/src/dir-${index}`, isDir: true })));
    await refreshDir(cwd);
    await listCachedDir(`${cwd}/src`);
    saveExpanded(cwd, new Set([cwd, `${cwd}/src`]));
    saveSelected(cwd, `${cwd}/src`);
    await act(async () => render());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New File"]')!.click());
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(60);
  });
  it("keeps a thousand files virtual and reaches the last row with End", async () => {
    directories.set(cwd, Array.from({ length: 1000 }, (_, index) => file(`entry-${index}.ts`)));
    await refreshDir(cwd);
    await act(async () => render());
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(60);
    const rootRow = container.querySelector<HTMLButtonElement>("[data-explorer-root]")!;
    await press(rootRow, { key: "End" });
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(row("entry-999.ts"));
    expect(row("entry-999.ts").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(60);
  });
  const selected = () =>
    container.querySelector<HTMLButtonElement>('[role="treeitem"].bg-selection')
      ?.title;

  beforeEach(async () => {
    directories.set(cwd, [folder("src"), file("first.ts"), file("second.ts")]);
    directories.set(`${cwd}/src`, [
      { name: "a.ts", path: `${cwd}/src/a.ts`, isDir: false, ignored: false },
    ]);
    await refreshDir(cwd);
    saveSelected(cwd, `${cwd}/src`);
    await act(async () => render());
  });

  it("moves the selection with the arrow keys and Home/End", async () => {
    await press(row("src"), { key: "ArrowDown" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(row("first.ts"), { key: "End" });
    expect(selected()).toBe(`${cwd}/second.ts`);
    await press(row("second.ts"), { key: "ArrowUp" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(row("first.ts"), { key: "Home" });
    expect(
      container
        .querySelector("[data-explorer-root]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(selected()).toBeUndefined();
  });

  it("expands with Right, enters the folder, and walks back out with Left", async () => {
    await press(row("src"), { key: "ArrowRight" });
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("src/a.ts")).not.toBeNull();
    await press(row("src"), { key: "ArrowRight" });
    expect(selected()).toBe(`${cwd}/src/a.ts`);
    await press(row("src/a.ts"), { key: "ArrowLeft" });
    expect(selected()).toBe(`${cwd}/src`);
    await press(row("src"), { key: "ArrowLeft" });
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens files with Enter and toggles folders", async () => {
    await press(row("src"), { key: "Enter" });
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    await press(row("src"), { key: "End" });
    await press(row("second.ts"), { key: "Enter" });
    expect(props.onOpenFile).toHaveBeenCalledWith(
      `${cwd}/second.ts`,
      undefined,
      { exact: true },
    );
  });

  it("jumps to a row by typing its name", async () => {
    await press(row("src"), { key: "s" });
    expect(selected()).toBe(`${cwd}/second.ts`);
    await press(row("second.ts"), { key: "s" });
    expect(selected()).toBe(`${cwd}/src`);
    await press(row("src"), { key: "f" });
    expect(selected()).toBe(`${cwd}/src`);
  });

  it("narrows the match as more of the name is typed", async () => {
    await press(row("src"), { key: "s" });
    await press(row("second.ts"), { key: "r" });
    expect(selected()).toBe(`${cwd}/src`);
  });

  it("moves by a viewport of rows and clamps at either end", async () => {
    const scroller = container.querySelector(".overflow-y-auto")!;
    Object.defineProperty(scroller, "clientHeight", { value: 84 });
    Object.defineProperty(row("second.ts"), "offsetHeight", { value: 28 });

    await press(row("src"), { key: "PageDown" });
    expect(selected()).toBe(`${cwd}/second.ts`);
    expect(document.activeElement).toBe(row("second.ts"));
    await press(row("second.ts"), { key: "PageUp" });
    expect(selected()).toBe(`${cwd}/src`);
    await press(row("src"), { key: "PageUp" });
    expect(document.activeElement).toBe(
      container.querySelector("[data-explorer-root]"),
    );
  });

  it("opens the focused file with Space and restores tree focus", async () => {
    vi.useFakeTimers();
    const editor = document.createElement("input");
    container.append(editor);
    props.onOpenFile = vi.fn(() => editor.focus());
    act(() => render());

    // Tab can focus a different row without changing the stored selection.
    row("first.ts").focus();
    await press(row("first.ts"), { key: " " });
    expect(props.onOpenFile).toHaveBeenCalledWith(
      `${cwd}/first.ts`,
      undefined,
      { exact: true },
    );
    expect(document.activeElement).toBe(editor);
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(document.activeElement).toBe(row("first.ts"));
    expect(selected()).toBe(`${cwd}/first.ts`);
  });

  it("skips closing folder rows and includes them again on rapid reopening", async () => {
    vi.useFakeTimers();
    await press(row("src"), { key: "ArrowRight" });
    const child = row("src/a.ts");
    await press(row("src"), { key: "ArrowLeft" });
    expect(child.closest("[inert]")).not.toBeNull();

    await press(row("src"), { key: "ArrowDown" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(row("first.ts"), { key: "a" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(child, { key: "Enter" });
    expect(props.onOpenFile).not.toHaveBeenCalled();

    await press(row("first.ts"), { key: "ArrowUp" });
    await press(row("src"), { key: "ArrowRight" });
    expect(row("src/a.ts")).toBe(child);
    await press(row("src"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(child);
  });

  it("keeps navigation at the root while the root is closing", async () => {
    vi.useFakeTimers();
    const rootRow = container.querySelector<HTMLButtonElement>(
      "[data-explorer-root]",
    )!;
    await press(row("src"), { key: "Home" });
    await press(rootRow, { key: "ArrowLeft" });
    expect(row("src").closest("[inert]")).not.toBeNull();
    await press(rootRow, { key: "End" });
    expect(document.activeElement).toBe(rootRow);
    await press(rootRow, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rootRow);
  });

  it("leaves composition and modified navigation keys alone", async () => {
    await press(row("src"), { key: "Enter", isComposing: true });
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
    await press(row("src"), { key: "ArrowDown", ctrlKey: true });
    await press(row("src"), { key: "ArrowDown", altKey: true });
    expect(selected()).toBe(`${cwd}/src`);
  });
});
