// @vitest-environment happy-dom
import {
  act,
  createElement,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  newFileTab,
  newTab,
  openEditorTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { useWorkspaceFiles, type WorkspaceFiles } from "./useWorkspaceFiles";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  diff: vi.fn(),
  remember: vi.fn(),
  invalidate: vi.fn(),
  composerFocus: vi.fn(),
  terminalFocus: vi.fn(),
  sidebar: vi.fn(),
}));
vi.mock("../../features/connections/files/model/fileIndex", () => ({
  resolveFileOpenRequest: mocks.open,
  resolveOpenablePath: mocks.diff,
  rememberOpenedFile: mocks.remember,
  invalidateProjectFiles: mocks.invalidate,
}));

let root: Root;
let container: HTMLDivElement;
let files: WorkspaceFiles;
let tabs: WorkspaceTab[];
let updateTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
let source: Session;
let sourceTab: WorkspaceTab;
const editorFiles = () =>
  tabs.flatMap((tab) => tab.editorPanes.flatMap((pane) => pane.files));
function deferred() {
  let resolve!: (path: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(initial = [sourceTab], dirty: string[] = []) {
  function Harness() {
    const [current, setTabs] = useState(initial);
    tabs = current;
    updateTabs = setTabs;
    files = useWorkspaceFiles({
      tabs: current,
      initialDirtyFileIds: dirty,
      context: () => ({
        tabs: current,
        sessions: [source],
        activeTabId: current[0]?.id ?? "",
        projectCwd: "/repo",
        sidebarCwd: "/repo",
        gitCwd: "/repo",
      }),
      ensureContentTab: () => current[0],
      activateTab: () => {},
      showWorkspace: () => {},
      setSidebarTab: mocks.sidebar,
      setTabs,
      setComposerFocused: mocks.composerFocus,
      setProjectTerminalFocused: mocks.terminalFocus,
    });
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  mocks.open.mockReset().mockImplementation(async (_cwd, path) => path);
  mocks.diff.mockReset().mockImplementation(async (_cwd, path) => path);
  source = { ...newSession("codex", "/repo"), id: "source" };
  sourceTab = newTab(source.id);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("pins an edited preview and keeps other dirty files when a close clears one", async () => {
  const preview = newFileTab("/repo/first.ts", "/repo");
  await mount([openEditorTab(sourceTab, preview)], ["another-file"]);
  expect(editorFiles()[0].preview).toBe(true);
  await act(async () => files.onFileDirtyChange(preview.id, true));
  expect(editorFiles()[0].preview).not.toBe(true);
  expect(files.isDirty(preview.id)).toBe(true);
  const saved = files.readDirtyFiles();
  await act(async () => files.forgetDirtyFiles([preview.id]));
  expect(files.isDirty(preview.id)).toBe(false);
  expect(files.isDirty("another-file")).toBe(true);
  expect(saved.has(preview.id)).toBe(true);
  await act(async () => files.forgetDirtyFiles(["another-file"]));
  expect(files.hasDirtyFiles()).toBe(false);
});

it("keeps a tab protected until every overlapping file and diff lookup finishes", async () => {
  const file = deferred();
  const diff = deferred();
  mocks.open.mockImplementationOnce(() => file.promise);
  mocks.diff.mockImplementationOnce(() => diff.promise);
  await mount();
  await act(async () => {
    files.onOpenFile("first.ts");
    files.onOpenDiff("second.ts", { sessionId: source.id, cwd: source.cwd });
  });
  expect(files.hasPendingResources(sourceTab.id)).toBe(true);
  await act(async () => file.resolve("/repo/first.ts"));
  expect(files.hasPendingResources(sourceTab.id)).toBe(true);
  await act(async () => diff.resolve("/repo/second.ts"));
  expect(files.hasPendingResources(sourceTab.id)).toBe(false);
  expect(editorFiles().some((file) => file.path === "/repo/first.ts")).toBe(
    true,
  );
  expect(
    editorFiles().some((file) => file.sessionChanges?.sessionId === source.id),
  ).toBe(true);
});

it.each(["file", "diff"])(
  "ignores a late %s open after its owning tab is removed",
  async (surface) => {
    const request = deferred();
    (surface === "file" ? mocks.open : mocks.diff).mockImplementationOnce(
      () => request.promise,
    );
    await mount();
    await act(async () => {
      if (surface === "file") files.onOpenFile("gone.ts", { line: 10 });
      else
        files.onOpenDiff("gone.ts", { sessionId: source.id, cwd: source.cwd });
    });
    await act(async () => updateTabs([newTab("other")]));
    mocks.composerFocus.mockClear();
    mocks.terminalFocus.mockClear();
    mocks.sidebar.mockClear();
    await act(async () => request.resolve("/repo/gone.ts"));
    expect(editorFiles()).toHaveLength(0);
    expect(files.editorNavigations[sourceTab.id]).toBeUndefined();
    expect(files.hasPendingResources(sourceTab.id)).toBe(false);
    expect(mocks.composerFocus).not.toHaveBeenCalled();
    expect(mocks.terminalFocus).not.toHaveBeenCalled();
    expect(mocks.sidebar).not.toHaveBeenCalled();
  },
);
