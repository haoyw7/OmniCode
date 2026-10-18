// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSession } from "../features/connections/model/protocol";
import { newSession, type Block } from "../features/sessions/model/session";
import type { GitDiffIndex, GitFileDiff } from "../platform/tauri/fs";
import { setUiLanguage } from "../shared/i18n/language";
import type { MobileGitSource } from "./mobileGit";
import { sessionChangesIndex } from "./mobileSessionChanges";
import { MobileTranscript } from "./MobileTranscript";

let app: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setUiLanguage("en");
  app = document.createElement("div");
  app.className = "mobile-app";
  document.body.append(app);
  root = createRoot(app);
});
afterEach(() => {
  act(() => root.unmount());
  app.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const index = (both = true): GitDiffIndex => ({
  branch: "feature",
  head: "head",
  additions: 2,
  deletions: 1,
  files: [
    {
      path: "src/app.ts",
      relative: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      staged: both,
      unstaged: true,
    },
  ],
  remote: null,
  upstream: null,
  defaultBranch: null,
  ahead: 0,
  behind: 0,
  aheadOfDefault: 0,
  headPushed: false,
});
const diff = (original = "old\n", current = "new\n"): GitFileDiff => ({
  path: "src/app.ts",
  relative: "src/app.ts",
  status: "modified",
  original,
  current,
  binary: false,
  tooLarge: false,
});
async function render(source: MobileGitSource, blocks: Block[] = [], cwd = "/repo") {
  const snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      ...newSession("codex", cwd),
      id: "session",
      blocks: [{ id: "user", role: "user", text: "Change the file" }, ...blocks],
    },
  };
  const onOverlayChange = vi.fn();
  let props: ComponentProps<typeof MobileTranscript> = {
    snapshot,
    disabled: false,
    onCommand: vi.fn(),
    gitSource: source,
    onOverlayChange,
  };
  const update = async (next: Partial<typeof props>) => {
    props = { ...props, ...next };
    await act(async () => root.render(createElement(MobileTranscript, props)));
  };
  await update({});
  return { update, onOverlayChange };
}
const activeDialog = () =>
  app.querySelector<HTMLElement>(
    '.mobile-sheet-backdrop:not([inert]) [role="dialog"]',
  )!;
const page = () =>
  activeDialog()?.querySelector<HTMLElement>('[data-page-active="true"]') ??
  activeDialog();
const diffText = (scope: ParentNode = page()) =>
  [...scope.querySelectorAll("diffs-container")]
    .map((node) => node.shadowRoot?.querySelector("[data-diff]")?.textContent ?? "")
    .join("\n");
const click = async (button: HTMLElement) => {
  await act(async () => { button.click(); await vi.dynamicImportSettled(); });
};
const settle = () => act(async () => vi.advanceTimersByTime(400));
async function openReview() {
  await click(
    app.querySelector<HTMLButtonElement>(".mobile-progress-capsule")!,
  );
  await click(
    activeDialog().querySelector<HTMLButtonElement>(".mobile-progress-row")!,
  );
  await settle();
}
const fileButton = (position = 0) =>
  page().querySelectorAll<HTMLButtonElement>(".mobile-git-file-row")[position];
const editBlock = (path = "src/app.ts"): Block => ({
  id: "edit", role: "tool", text: `Edit ${path}`,
  tool: {
    kind: "edit", status: "completed",
    preview: {
      kind: "write", path, additions: 1, deletions: 1,
      lines: [
        { number: 1, kind: "del", text: "before" },
        { number: 1, kind: "add", text: "after" },
      ],
    },
  },
});

describe("mobile Git review from the progress capsule", () => {
  it.each([
    ["/repo", "src/app.ts", "/repo/src/app.ts"],
    ["/repo", "/repo/src/app.ts", "/repo/src/app.ts"],
    ["C:\\repo", "c:\\REPO\\src\\app.ts", "C:/repo/src/app.ts"],
  ])("opens a single-file link in the shared review for %s / %s", async (cwd, path, indexPath) => {
    const loadDiff = vi.fn(async () => diff());
    const { update, onOverlayChange } = await render({
      loadIndex: vi.fn(async () => ({
        ...index(), additions: 22, deletions: 11,
        files: [
          { ...index().files[0], path: indexPath },
          { ...index().files[0], path: "src/other.ts", relative: "src/other.ts", additions: 20, deletions: 10 },
        ],
      })),
      loadDiff,
    }, [editBlock(path)], cwd);
    const readBinaryFile = vi.fn(async () => new TextEncoder().encode("file contents"));
    await update({ readBinaryFile });
    await click(app.querySelector<HTMLButtonElement>('[data-tool-open-row] button[aria-label^="Open "]')!);
    await settle();
    expect(activeDialog().getAttribute("aria-label")).toBe("Uncommitted changes");
    expect(page().querySelectorAll(".mobile-git-file-row")).toHaveLength(1);
    expect(fileButton().getAttribute("aria-expanded")).toBe("true");
    expect(page().querySelector(".mobile-git-toolbar")?.textContent).toBe("+2−1");
    expect(loadDiff.mock.calls).toEqual([["src/app.ts"]]);
    expect(readBinaryFile).not.toHaveBeenCalled();
    expect(page().querySelector('[aria-label="Wrap lines"]')).not.toBeNull();
    await act(async () => onOverlayChange.mock.calls.at(-1)![0]());
    await settle();
    expect(activeDialog()).toBeNull();
  });

  it("shows a tool's own edit inline in review style without loading Git", async () => {
    const source = {
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(async () => diff()),
    };
    await render(source, [editBlock()]);
    await click(app.querySelector<HTMLElement>("[data-tool-open-row]")!);
    await settle();
    const sheet = activeDialog();
    expect(page().querySelector(".file-preview-list")).toBeNull();
    expect(page().querySelector('[aria-label="Review changes"]')).toBeNull();
    const row = page().querySelector<HTMLButtonElement>(".mobile-tool-diff .mobile-git-file-row")!;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(diffText()).toContain("after");
    await click(row);
    expect(activeDialog()).toBe(sheet);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(source.loadDiff).not.toHaveBeenCalled();
  });

  it("shows the empty state when a single file no longer has changes", async () => {
    const loadDiff = vi.fn(async () => diff());
    await render({
      loadIndex: vi.fn(async () => ({ ...index(), files: [], additions: 0, deletions: 0 })),
      loadDiff,
    }, [editBlock()]);
    await click(app.querySelector<HTMLButtonElement>('[data-tool-open-row] button[aria-label^="Open "]')!);
    await settle();
    expect(page().textContent).toContain("No file changes");
    expect(loadDiff).not.toHaveBeenCalled();
  });

  it("keeps an activity step's edit inside the activity sheet", async () => {
    await render({
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(async () => diff()),
    }, [editBlock(), {
      id: "shell", role: "tool", text: "bash npm test",
      tool: { kind: "shell", status: "completed", preview: { kind: "shell", output: "ok" } },
    }, { id: "answer", role: "assistant", text: "Done." }]);
    await click(app.querySelector<HTMLButtonElement>("[data-activity-sheet]")!);
    await settle();
    const sheet = activeDialog();
    await click(page().querySelector<HTMLButtonElement>(".mobile-activity-step button")!);
    await settle();
    expect(activeDialog()).toBe(sheet);
    expect(page().querySelector(".mobile-tool-diff .mobile-git-file-row")?.getAttribute("aria-expanded")).toBe("true");
    expect(diffText()).toContain("after");
    await click(page().querySelector<HTMLButtonElement>('[aria-label="Back"]')!);
    await settle();
    expect(page().querySelectorAll(".mobile-activity-step")).toHaveLength(2);
  });

  it("expands the combined diff in its file row and returns directly to progress with native Back", async () => {
    const source: MobileGitSource = {
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(async () => diff("HEAD version\n", "Working version\n")),
    };
    const { onOverlayChange } = await render(source);
    expect(
      app.querySelector(".mobile-progress-capsule")?.textContent,
    ).toContain("+2−1");
    await openReview();
    expect(page().textContent).toContain("1 file changed");
    expect(page().querySelector('[aria-label="Refresh changes"]')).toBeNull();
    expect(page().textContent).not.toMatch(/Staged|Unstaged|feature/);
    expect(page().querySelectorAll(".mobile-git-file-row")).toHaveLength(1);
    const review = activeDialog();
    const row = fileButton();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(source.loadDiff).not.toHaveBeenCalled();
    await click(fileButton());
    expect(activeDialog()).toBe(review);
    expect(fileButton()).toBe(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(review.querySelector(".mobile-sheet-header")?.textContent).toContain("1 file changed");
    expect(review.querySelector(".file-preview-list")).toBeNull();
    const body = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(source.loadDiff).toHaveBeenLastCalledWith("src/app.ts");
    await act(async () => {
      await vi.waitFor(() => expect(diffText(body)).toContain("HEAD version"));
    });
    expect(diffText(body)).toContain("Working version");
    await settle();
    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(body.isConnected).toBe(true);
    expect(body.closest("[inert]")).not.toBeNull();
    await click(row);
    expect(body.closest("[inert]")).toBeNull();
    await settle();
    await click(row);
    await settle();
    expect(body.isConnected).toBe(false);
    await act(async () => onOverlayChange.mock.calls.at(-1)![0]());
    expect(activeDialog().getAttribute("aria-label")).toBe("Session progress");
  });

  it.each([
    [{ binary: true }, "Binary file changed"],
    [{ tooLarge: true }, "Diff is too large to display"],
    [{ original: "same", current: "same" }, "No textual diff"],
  ] as const)(
    "keeps zero-line changes reachable and explains %s",
    async (overrides, message) => {
      const source: MobileGitSource = {
        loadIndex: vi.fn(async () => ({
          ...index(false),
          additions: 0,
          deletions: 0,
        })),
        loadDiff: vi.fn(async () => ({ ...diff(), ...overrides })),
      };
      await render(source);
      expect(
        app.querySelector(".mobile-progress-capsule")?.textContent,
      ).toContain("1 file changed");
      await openReview();
      await click(fileButton());
      expect(page().textContent).toContain(message);
      expect(page().querySelector(".mobile-git-diff")).toBeNull();
      expect(fileButton().hasAttribute("aria-busy")).toBe(false);
    },
  );

  it("shows errors instead of an empty diff and retries files when reopened", async () => {
    const loadIndex = vi.fn(async () => index(false));
    loadIndex.mockRejectedValueOnce(new Error("Index read failed"));
    const loadDiff = vi.fn(async () => diff());
    loadDiff.mockRejectedValueOnce(new Error("File changed during read"));
    await render({ loadIndex, loadDiff });
    await click(
      app.querySelector<HTMLButtonElement>(".mobile-progress-capsule")!,
    );
    expect(activeDialog().textContent).toContain("Could not load changes.");
    await click(
      activeDialog().querySelector<HTMLButtonElement>(".mobile-progress-row")!,
    );
    await click(fileButton());
    expect(page().querySelector('[role="alert"]')?.textContent).toContain(
      "File changed during read",
    );
    expect(page().textContent).not.toContain("No textual diff");
    await click(fileButton());
    await settle();
    await click(fileButton());
    expect(page().querySelector('[role="alert"]')).toBeNull();
    expect(diffText()).toContain(
      "new",
    );
    expect(fileButton().getAttribute("aria-expanded")).toBe("true");
    expect(loadDiff).toHaveBeenCalledTimes(2);
  });

  it("automatically refreshes an emptied working copy without dismissing review or keeping stale capsule counts", async () => {
    const loadIndex = vi.fn(async () => index(false));
    const loadDiff = vi.fn(async () => diff());
    await render({ loadIndex, loadDiff });
    await openReview();
    await click(fileButton());
    loadIndex.mockResolvedValue({
      ...index(false),
      files: [],
      additions: 0,
      deletions: 0,
    });
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(page().textContent).toContain("No file changes");
    expect(page().querySelector(".mobile-git-file-row")).toBeNull();
    await click(
      page().querySelector<HTMLButtonElement>('[aria-label="Back"]')!,
    );
    expect(activeDialog().getAttribute("aria-label")).toBe("Session progress");
    expect(
      app.querySelector(".mobile-progress-capsule")?.textContent,
    ).not.toContain("+2");
  });

  it("starts opening only after a slow diff has loaded and rendered", async () => {
    let finish!: (value: GitFileDiff) => void;
    await render({
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    });
    await openReview();
    await click(fileButton());
    const collapse = fileButton().parentElement!.querySelector<HTMLElement>(".zen-fold-item")!;
    await settle();
    expect(fileButton().getAttribute("aria-busy")).toBe("true");
    expect(collapse.style.height).toBe("0px");
    expect(collapse.inert).toBe(true);
    await act(async () => finish(diff()));
    expect(diffText()).toContain("new");
    expect(collapse.dataset.foldState).toBe("opening");
    expect(collapse.inert).toBe(false);
    expect(fileButton().hasAttribute("aria-busy")).toBe(false);
    await settle();
    expect(collapse.dataset.foldState).toBe("open");
  });

  it("ignores a collapsed file's late response while another file is expanded", async () => {
    let finish!: (value: GitFileDiff) => void;
    const loadDiff = vi.fn<MobileGitSource["loadDiff"]>(async () =>
      diff("Index\n", "Current\n"),
    );
    loadDiff.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const files = index().files;
    await render({
      loadIndex: vi.fn(async () => ({
        ...index(),
        files: [...files, { ...files[0], relative: "src/other.ts" }],
      })),
      loadDiff,
    });
    await openReview();
    await click(fileButton());
    expect(fileButton().getAttribute("aria-busy")).toBe("true");
    const collapse = fileButton().parentElement!.querySelector<HTMLElement>(".zen-fold-item")!;
    await settle();
    expect(collapse.dataset.foldState).toBe("closed");
    expect(collapse.inert).toBe(true);
    expect(collapse.style.height).toBe("0px");
    await click(fileButton());
    await click(fileButton(1));
    await act(async () => finish(diff("Old request\n", "Old result\n")));
    expect(diffText()).toContain("Current");
    expect(diffText()).not.toContain("Old result");
    await click(fileButton());
    expect(fileButton().getAttribute("aria-expanded")).toBe("true");
    expect(fileButton(1).getAttribute("aria-expanded")).toBe("true");
    expect(page().querySelectorAll(".mobile-git-diff")).toHaveLength(2);
    expect(loadDiff).toHaveBeenCalledTimes(3);
  });

  it("loads only expanded diffs and lets an offline row collapse", async () => {
    const files = index().files;
    const loadDiff = vi.fn(async () => diff());
    const { update } = await render({
      loadIndex: vi.fn(async () => ({
        ...index(),
        files: [...files, { ...files[0], relative: "src/other.ts" }],
      })),
      loadDiff,
    });
    await openReview();
    await click(fileButton());
    expect(loadDiff.mock.calls).toEqual([["src/app.ts"]]);
    await update({ gitEnabled: false });
    expect(fileButton().disabled).toBe(false);
    expect(fileButton(1).disabled).toBe(true);
    await click(fileButton());
    await settle();
    expect(page().querySelector(".mobile-git-diff")).toBeNull();
    expect(loadDiff).toHaveBeenCalledTimes(1);
  });

  it("keeps long diffs inline, with highlighted changes and localized context gaps", async () => {
    const original = Array.from({ length: 360 }, (_, index) => `const value${index} = ${index};`);
    const current = [...original];
    current[2] = 'const value2 = "changed near the start";';
    current[350] = 'const value350 = "changed near the end";';
    await render({
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(async () => diff(original.join("\n"), current.join("\n"))),
    });
    await openReview();
    await click(fileButton());
    await act(async () => {
      await vi.waitFor(() => expect(diffText()).toContain("changed near the end"));
    });
    expect(diffText()).toContain("changed near the start");
    expect(page().querySelector(".readonly-text-view")).toBeNull();
    const shadow = page().querySelector("diffs-container")!.shadowRoot!;
    expect(shadow.querySelector("[data-line] span[style]")).not.toBeNull();
    expect(shadow.querySelector("[data-unmodified-lines]")?.textContent).toContain("unmodified lines");
    await act(async () => setUiLanguage("zh-CN"));
    expect(shadow.querySelector("[data-unmodified-lines]")?.textContent).toContain("行未改动");
  });

  it("expands a large file with only two added lines using bounded patch context", async () => {
    const original = Array.from({ length: 8_000 }, (_, index) => `const value${index} = ${index};`);
    const current = [...original];
    current.splice(4_000, 0, 'const addedFirst = "first addition";', 'const addedSecond = "second addition";');
    await render({
      loadIndex: vi.fn(async () => ({ ...index(), deletions: 0,
        files: [{ ...index().files[0], deletions: 0 }],
      })),
      loadDiff: vi.fn(async () => diff(original.join("\n"), current.join("\n"))),
    });
    await openReview();
    await click(fileButton());
    expect(page().textContent).not.toContain("Diff is too large to display");
    expect(diffText()).toContain("first addition");
    expect(diffText()).toContain("second addition");
    const shadow = page().querySelector("diffs-container")!.shadowRoot!;
    expect(shadow.querySelectorAll("[data-line]").length).toBeLessThan(30);
    expect(shadow.querySelector("[data-expand-button]")).toBeNull();
    expect(page().textContent).not.toContain("Unmodified content is too large");
    await click(page().querySelector<HTMLButtonElement>(".mobile-diff-context-toggle")!);
    expect(page().textContent).toContain("Unmodified content is too large to expand");
    expect(diffText()).toContain("first addition");
    expect(diffText()).toContain("second addition");
    await act(async () => setUiLanguage("zh-CN"));
    expect(page().textContent).toContain("未改动内容过大，无法展开");
  });

  it("expands and collapses a bounded unchanged section in a large file", async () => {
    const original = Array.from({ length: 2_000 }, (_, index) => `const value${index} = ${index};`);
    const current = [...original];
    current[100] = "const changed = true;";
    await render({
      loadIndex: vi.fn(async () => index()),
      loadDiff: vi.fn(async () => diff(original.join("\n"), current.join("\n"))),
    });
    await openReview();
    await click(fileButton());
    expect(diffText()).not.toContain("const value0 = 0;");
    const toggle = page().querySelector<HTMLButtonElement>(".mobile-diff-context-toggle")!;
    await click(toggle);
    await settle();
    expect(diffText()).toContain("const value0 = 0;");
    expect(diffText()).toContain("const changed = true;");
    await click(toggle);
    await settle();
    expect(diffText()).not.toContain("const value0 = 0;");
    expect(diffText()).toContain("const changed = true;");
  });

  it("switches all file diffs between horizontal scrolling and wrapping without reloading them", async () => {
    const files = index().files;
    const loadDiff = vi.fn(async () => diff("old\n", "const current = 'a long line to review';\n"));
    await render({
      loadIndex: vi.fn(async () => ({
        ...index(),
        files: [...files, { ...files[0], relative: "src/other.ts" }],
      })),
      loadDiff,
    });
    await openReview();
    const toggle = page().querySelector<HTMLButtonElement>('.mobile-sheet-header [aria-label="Wrap lines"]')!;
    const modes = () => [...page().querySelectorAll("diffs-container")]
      .map((node) => node.shadowRoot?.querySelector("[data-overflow]")?.getAttribute("data-overflow"));
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await click(fileButton());
    expect(modes()).toEqual(["scroll"]);
    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(modes()).toEqual(["wrap"]);
    await click(fileButton(1));
    expect(modes()).toEqual(["wrap", "wrap"]);
    await click(toggle);
    expect(modes()).toEqual(["scroll", "scroll"]);
    expect(fileButton().getAttribute("aria-expanded")).toBe("true");
    expect(fileButton(1).getAttribute("aria-expanded")).toBe("true");
    expect(loadDiff).toHaveBeenCalledTimes(2);
  });
});

describe("mobile session changes", () => {
  const sessionSource = (undoable = true) => ({
    loadIndex: vi.fn(async () => sessionChangesIndex({
      files: [{ path: "/repo/src/app.ts", relative: "src/app.ts", status: "modified",
        additions: 2, deletions: 1, exact: true, undoable }],
    })),
    loadDiff: vi.fn(async () => diff()),
    keep: vi.fn(async () => {}),
    undo: vi.fn(async () => {}),
  });
  async function openSessionReview(source: ReturnType<typeof sessionSource>) {
    const { update } = await render({ loadIndex: vi.fn(async () => index()), loadDiff: vi.fn(async () => diff()) });
    await update({ sessionChangesSource: source });
    await settle();
    await click(app.querySelector<HTMLButtonElement>(".mobile-progress-capsule")!);
    expect(activeDialog().querySelector(".mobile-progress-section h3")?.textContent).toContain("Session changes");
    await click(activeDialog().querySelector<HTMLButtonElement>(".mobile-progress-row")!);
    await settle();
    expect(activeDialog().getAttribute("aria-label")).toBe("Session changes");
  }
  const action = (label: string) =>
    [...page().querySelectorAll<HTMLButtonElement>(".mobile-git-action")].find((button) => button.textContent === label);

  it("needs a second tap before undoing the conversation's edits", async () => {
    const source = sessionSource();
    await openSessionReview(source);
    await click(fileButton());
    await settle();
    expect(source.loadDiff).toHaveBeenCalledWith("src/app.ts");

    await click(action("Undo")!);
    expect(source.undo).not.toHaveBeenCalled();
    await click(action("Confirm undo")!);
    expect(source.undo).toHaveBeenCalledTimes(1);

    await click(action("Keep")!);
    expect(source.keep).toHaveBeenCalledTimes(1);
  });

  it("disables undo after a file changed outside the conversation", async () => {
    const source = sessionSource(false);
    await openSessionReview(source);
    expect(action("Undo")!.disabled).toBe(true);
    expect(action("Undo")!.title).toBe("Undo is unavailable because a file changed outside this session");
    expect(action("Keep")!.disabled).toBe(false);
  });

  it("discloses concurrent workspace edits and disables undo", async () => {
    const source = sessionSource();
    source.loadIndex.mockResolvedValue(sessionChangesIndex({
      workspaceShared: true,
      files: [{ path: "/repo/src/app.ts", relative: "src/app.ts", status: "modified",
        additions: 2, deletions: 1, exact: true, undoable: false }],
    }));
    await openSessionReview(source);
    expect(activeDialog().textContent).toContain("These changes may include their edits; undo is disabled.");
    expect(action("Undo")!.disabled).toBe(true);
    expect(action("Keep")!.disabled).toBe(false);
  });
});
