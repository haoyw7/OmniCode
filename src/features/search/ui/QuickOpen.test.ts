// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { projectFiles, remoteFiles, loadProjectFiles, rankProjectFiles } =
  vi.hoisted(() => {
    const projectFiles = [
      {
        path: "/repo/src/App.tsx",
        relative: "src/App.tsx",
        name: "App.tsx",
      },
    ];
    const remoteFiles = [
      {
        path: "remote://env/home/me/repo/src/App.tsx",
        relative: "src/App.tsx",
        name: "App.tsx",
      },
    ];
    return {
      projectFiles,
      remoteFiles,
      loadProjectFiles: vi.fn((cwd: string) =>
        cwd.startsWith("remote://")
          ? Promise.resolve(remoteFiles)
          : new Promise(() => {}),
      ),
      rankProjectFiles: vi.fn((_files: unknown[], query: string) =>
        query.trim() && !query.toLowerCase().includes("app")
          ? []
          : (_files as typeof projectFiles).map((file) => ({
              ...file,
              score: 1,
              positions: [],
            })),
      ),
    };
  });

vi.mock("../../connections/files/model/fileIndex", () => ({
  loadProjectFiles,
  peekProjectFiles: vi.fn((cwd: string) =>
    cwd.startsWith("remote://") ? null : projectFiles,
  ),
  rankProjectFiles,
  recentOpenedFiles: vi.fn(() => []),
  rememberOpenedFile: vi.fn(),
}));

vi.mock("../../projects/model/recents", () => ({
  looksLikeProject: (path: string) => path !== "~",
  sameProjectPath: (a: string, b: string) => a === b,
}));

import { QuickOpen } from "./QuickOpen";
import { setUiLanguage } from "../../../shared/i18n/language";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setUiLanguage("en");
  container.remove();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const COMMANDS = [
  { id: "View: Reload", title: "Reload" },
  { id: "Pane: Split Right", title: "Split Right" },
  { id: "App: Settings", title: "Settings…" },
];

const SESSIONS = [
  {
    id: "s-old",
    cwd: "/other",
    harness: "claude" as const,
    title: "Fix login bug",
    updatedAt: 1,
  },
  {
    id: "s-new",
    cwd: "/repo",
    harness: "codex" as const,
    title: "Refactor parser",
    updatedAt: 2,
  },
];

const RECENTS = [
  { path: "/repo", openedAt: 2 },
  { path: "/work/monocode", openedAt: 3 },
];

function renderPalette(
  initialQuery = "",
  extra: Partial<Parameters<typeof QuickOpen>[0]> = {},
) {
  const callbacks = {
    onOpenFile: vi.fn(),
    onRunCommand: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenProject: vi.fn(),
    onAddProject: vi.fn(),
    onSearchEverywhere: vi.fn(),
    onClose: vi.fn(),
  };
  act(() =>
    root.render(
      createElement(QuickOpen, {
        open: true,
        cwd: "/repo",
        initialQuery,
        commands: COMMANDS,
        commandShortcut: (id: string) =>
          id === "View: Reload" ? "Ctrl+Shift+R" : null,
        sessions: SESSIONS,
        recents: RECENTS,
        currentProject: "/repo",
        ...callbacks,
        ...extra,
      }),
    ),
  );
  const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  return { ...callbacks, dialog, input };
}

function inputText(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {},
) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function options(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

describe("quick open command mode", () => {
  it("opens from an initial > query without ranking project files", () => {
    const { dialog, input } = renderPalette(">");
    expect(dialog.getAttribute("aria-label")).toBe("Command Palette");
    expect(input.value).toBe(">");
    expect(input.placeholder).toContain("> for commands");
    expect(
      dialog.querySelector('[role="listbox"][aria-label="Commands"]'),
    ).not.toBeNull();
    expect(dialog.textContent).toContain("View: Reload");
    expect(dialog.textContent).toContain("Ctrl+Shift+R");
    expect(rankProjectFiles).not.toHaveBeenCalled();
  });

  it("only treats a leading > as command mode and reverts when it is deleted", () => {
    const { dialog, input } = renderPalette();

    inputText(input, "App>");
    expect(dialog.getAttribute("aria-label")).toBe("Go to File");
    expect(
      dialog.querySelector('[role="listbox"][aria-label="Files"]'),
    ).not.toBeNull();

    rankProjectFiles.mockClear();
    inputText(input, ">");
    expect(dialog.getAttribute("aria-label")).toBe("Command Palette");
    expect(rankProjectFiles).not.toHaveBeenCalled();

    inputText(input, "App");
    expect(dialog.getAttribute("aria-label")).toBe("Go to File");
    expect(rankProjectFiles).toHaveBeenCalled();
  });

  it("fuzzy-filters and highlights commands with palette-specific empty copy", () => {
    const { dialog, input } = renderPalette(">");

    inputText(input, "> splr");
    const split = options(dialog).find((button) =>
      button.textContent?.includes("Pane: Split Right"),
    )!;
    expect(split).toBeDefined();
    expect(split.querySelectorAll(".text-accent").length).toBeGreaterThan(0);
    expect(options(dialog)).toHaveLength(2);

    inputText(input, "> missing");
    expect(dialog.textContent).toContain("No matching commands");
    expect(options(dialog).at(-1)?.textContent).toContain(
      "Search everywhere for “missing”",
    );
  });

  it.each(["click", "Enter"] as const)(
    "runs the selected command after closing on %s",
    (method) => {
      const callbacks = renderPalette(">");
      const first = callbacks.dialog.querySelector<HTMLButtonElement>(
        '[role="option"][aria-selected="true"]',
      )!;

      if (method === "click") act(() => first.click());
      else press(callbacks.input, "Enter");

      expect(callbacks.onClose).toHaveBeenCalledOnce();
      expect(callbacks.onRunCommand).toHaveBeenCalledExactlyOnceWith(
        "View: Reload",
      );
      expect(callbacks.onOpenFile).not.toHaveBeenCalled();
      expect(
        JSON.parse(localStorage.getItem("monocode.quickOpen.recentCommands")!),
      ).toEqual(["View: Reload"]);
    },
  );

  it("lists recently run commands first", () => {
    localStorage.setItem(
      "monocode.quickOpen.recentCommands",
      JSON.stringify(["App: Settings"]),
    );
    const { dialog } = renderPalette(">");
    expect(options(dialog)[0].textContent).toContain("App: Settings");
  });
});

describe("quick open session and project modes", () => {
  it("lists the current project's sessions first and opens one", () => {
    const callbacks = renderPalette("#");
    expect(callbacks.dialog.getAttribute("aria-label")).toBe("Go to Session");
    const rows = options(callbacks.dialog);
    expect(rows.slice(0, -1).map((row) => row.textContent)).toEqual([
      "Refactor parserrepo",
      "Fix login bugother",
    ]);
    inputText(callbacks.input, "#login");
    press(callbacks.input, "Enter");
    expect(callbacks.onOpenSession).toHaveBeenCalledExactlyOnceWith("s-old");
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it("lists projects by recency, filters them and offers Open Project", () => {
    const callbacks = renderPalette("@");
    const rows = options(callbacks.dialog);
    expect(rows[0].textContent).toContain("monocode");
    expect(rows.at(-2)!.textContent).toContain("Open Project…");
    expect(rows.at(-1)!.textContent).toContain("Search everywhere");

    inputText(callbacks.input, "@ repo");
    press(callbacks.input, "Enter");
    expect(callbacks.onOpenProject).toHaveBeenCalledExactlyOnceWith("/repo");
  });

  it("switches modes from the chips while keeping the typed text", () => {
    const { dialog, input } = renderPalette("parser");
    const sessions = [
      ...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent?.startsWith("Sessions"))!;
    act(() => sessions.click());
    expect(input.value).toBe("#parser");
    expect(dialog.getAttribute("aria-label")).toBe("Go to Session");
  });
});

describe("search everywhere", () => {
  it("localizes the empty-query entry in zh-CN", () => {
    setUiLanguage("zh-CN");
    const callbacks = renderPalette();
    expect(options(callbacks.dialog).at(-1)?.textContent).toContain(
      "搜索全部内容",
    );
    expect(callbacks.dialog.textContent).not.toContain("Search everywhere");
  });

  it.each(["", ">", "#", "@"])(
    "offers an entry with no query in mode %s",
    (query) => {
      const callbacks = renderPalette(query);
      const last = options(callbacks.dialog).at(-1)!;
      expect(last.textContent).toContain("Search everywhere");
      act(() => last.click());
      expect(callbacks.onSearchEverywhere).toHaveBeenCalledExactlyOnceWith("");
    },
  );

  it("searches command text through the final row shortcut", () => {
    const callbacks = renderPalette(">missing");
    press(callbacks.input, "Enter", { ctrlKey: true });
    expect(callbacks.onSearchEverywhere).toHaveBeenCalledExactlyOnceWith(
      "missing",
    );
    expect(callbacks.onRunCommand).not.toHaveBeenCalled();
  });

  it("offers a final row and runs it with Ctrl+Enter", () => {
    const callbacks = renderPalette("App");
    const last = options(callbacks.dialog).at(-1)!;
    expect(last.textContent).toContain("Search everywhere for “App”");

    press(callbacks.input, "Enter", { ctrlKey: true });
    expect(callbacks.onSearchEverywhere).toHaveBeenCalledExactlyOnceWith("App");
    expect(callbacks.onOpenFile).not.toHaveBeenCalled();
  });

  it("runs from the row in session mode with the text after the prefix", () => {
    const callbacks = renderPalette("#nothing-matches");
    expect(callbacks.dialog.textContent).toContain("No matching sessions");
    const last = options(callbacks.dialog).at(-1)!;
    act(() => last.click());
    expect(callbacks.onSearchEverywhere).toHaveBeenCalledExactlyOnceWith(
      "nothing-matches",
    );
  });
});

describe("quick open on a remote project", () => {
  const cwd = "remote://env/home/me/repo";

  it("uses the shared file list and opens its remote path", async () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(QuickOpen, {
          open: true,
          cwd,
          initialQuery: "app",
          onOpenFile,
          onRunCommand: vi.fn(),
          onClose,
        }),
      ),
    );
    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    expect(loadProjectFiles).toHaveBeenCalledWith(cwd, true);
    expect(dialog.textContent).toContain("App.tsx");

    press(dialog.querySelector<HTMLInputElement>("input")!, "Enter");
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      remoteFiles[0].path,
      undefined,
      { exact: true },
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a connection error from the shared file list", async () => {
    loadProjectFiles.mockRejectedValueOnce(
      new Error("Machine is not connected"),
    );
    await act(async () =>
      root.render(
        createElement(QuickOpen, {
          open: true,
          cwd,
          onOpenFile: vi.fn(),
          onRunCommand: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.body.textContent).toContain("Machine is not connected");
  });
});
