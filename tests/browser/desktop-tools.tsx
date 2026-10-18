// Offline RPC data with the real desktop shell, file tree, editor, review and xterm UI.
import { useEffect, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { WindowResizeHandles } from "../../src/app/shell/WindowResizeHandles";
import { WindowResizeObserver } from "../../src/app/shell/WindowResizeObserver";
import { WorkspaceToolsDock } from "../../src/app/shell/WorkspaceToolsDock";
import { TerminalDockLayout } from "../../src/app/shell/TerminalDockLayout";
import { Sidebar } from "../../src/app/shell/Sidebar";
import { SidebarMain } from "../../src/app/shell/SidebarMain";
import { SidebarRail } from "../../src/app/shell/SidebarTransition";
import { DesktopModeToggle, DesktopNavigation, DesktopNewSessionAction, DesktopTitlebarNavigation } from "../../src/app/shell/DesktopNavigation";
import { ActivityBar } from "../../src/app/shell/ActivityBar";
import { WindowDragBar } from "../../src/app/shell/WindowChrome";
import { WindowMenuButton } from "../../src/app/shell/WindowMenuButton";
import { SessionHeaderActionsContext, type SessionHeaderActions } from "../../src/features/workspace/ui/SessionHeaderActions";
import type { SidebarProps } from "../../src/app/shell/Sidebar.types";
import { PaneTree } from "../../src/features/workspace/ui/PaneTree";
import { newSession } from "../../src/features/sessions/model/session";
import { TranscriptPool, TranscriptPoolOutlet } from "../../src/features/sessions/ui/TranscriptPool";
import type { EditorPane, FilePaneTab, LayoutNode, PaneEdge } from "../../src/features/workspace/model/layout";
import { moveTabPane, newTab, setSplitRatio } from "../../src/features/workspace/model/layout";
import type { ProjectTerminalDock } from "../../src/features/projects/model/projectTerminal";
import type { FsEntry, GitDiffIndex, GitFileDiff, GitHistory } from "../../src/platform/tauri/fs";
import { SurfaceVisibilityContext } from "../../src/shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../../src/shared/i18n/language";
import { applyDesktopSkin } from "../../src/shared/theme/desktopSkin";
import { saveExpanded } from "../../src/features/connections/files/model/fileTree";
import "../../src/styles/index.css";

import { Terminal } from "@xterm/xterm";
const fixtureTerminals = new WeakMap<Element, Terminal>();
const originalOpen = Terminal.prototype.open;
Terminal.prototype.open = function (parent) {
  originalOpen.call(this, parent);
  if (this.element) fixtureTerminals.set(this.element, this);
};
function readTerminal(paneId = "tools-editor") {
  const element = document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"] .xterm`);
  const term = element ? fixtureTerminals.get(element) : undefined;
  if (!term) return { lines: [] as string[], cols: 0, rows: 0 };
  const buffer = term.buffer.active;
  return { cols: term.cols, rows: term.rows, lines: Array.from({ length: term.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "") };
}

const query = new URLSearchParams(location.search);
const cwd = "/fixture/omnicode";
const sourcePath = `${cwd}/src/workspace.ts`;
const reviewLines = Array.from({ length: 90 }, (_, index) =>
  `export const setting${index} = "${"Review resizing preserves syntax, line numbers and annotations. ".repeat(5)}";`,
);
const original = query.has("reviewResize")
  ? reviewLines.join("\n") + "\n"
  : "export const workspace = {\n  panelGap: 8,\n  composerRadius: 12,\n};\n";
const current = query.has("reviewResize")
  ? reviewLines.map((line, index) => index === 8 || index === 70 ? line.replace("preserves", "retains") : line).join("\n") + "\n"
  : "export const workspace = {\n  panelGap: 12,\n  composerRadius: 14,\n  preserveSessions: true,\n};\n";
const noop = () => {};
setUiLanguage(query.get("lang") === "zh-CN" ? "zh-CN" : "en");
document.documentElement.classList.toggle("theme-light", query.get("theme") !== "dark");
localStorage.setItem("omnicode.desktopColorScheme", query.get("theme") === "dark" ? "dark" : "light");
localStorage.setItem("omnicode.autosave", "false");
applyDesktopSkin();
document.documentElement.dataset.desktopMode = "code";
saveExpanded(cwd, new Set([cwd, `${cwd}/src`]));

const files: GitDiffIndex["files"] = [
  { path: sourcePath, relative: "src/workspace.ts", status: "modified", additions: 3, deletions: 2, staged: false, unstaged: true },
  { path: `${cwd}/README.md`, relative: "README.md", status: "modified", additions: 2, deletions: 1, staged: true, unstaged: false },
  { path: `${cwd}/docs/layout.md`, relative: "docs/layout.md", status: "untracked", additions: 4, deletions: 0, staged: false, unstaged: true },
];
const index: GitDiffIndex = { branch: "main", head: "a1b2c3d", files, additions: 9, deletions: 3, remote: null, upstream: null, defaultBranch: "main", ahead: 0, behind: 0, aheadOfDefault: 0, headPushed: true };
const history: GitHistory = { head: "a1b2c3d", commits: [
  { sha: "a1b2c3d", shortSha: "a1b2c3d", parents: ["b2c3d4e"], author: "Workspace owner", timestamp: 1791891000, subject: "Refine workspace spacing", refs: [{ name: "main", kind: "local" }], head: true },
  { sha: "b2c3d4e", shortSha: "b2c3d4e", parents: [], author: "Workspace owner", timestamp: 1791804600, subject: "Keep project tools together", refs: [], head: false },
] };
const entries = (path: string): FsEntry[] => {
  const children = path === cwd ? ["src/", "docs/", "README.md", "package.json", "vite.config.ts"]
    : path === `${cwd}/src` ? ["workspace.ts", "App.tsx", "styles.css"] : ["layout.md"];
  return children.map(name => ({ name: name.replace(/\/$/, ""), path: `${path}/${name.replace(/\/$/, "")}`, isDir: name.endsWith("/"), ignored: false }));
};
const diff = (relative = "src/workspace.ts"): GitFileDiff => ({ path: `${cwd}/${relative}`, relative, status: "modified", original, current, binary: false, tooLarge: false });
type EventCallback = (event: { event: string; id: number; payload: unknown }) => void;
const callbacks = new Map<number, EventCallback>();
const listeners = new Map<string, Map<number, number>>();
let callbackId = 0;
let listenerId = 0;
const rpc: { command: string; args?: Record<string, unknown> }[] = [];
const emit = (event: string, payload: unknown) => {
  for (const [id, handler] of listeners.get(event) ?? []) callbacks.get(handler)?.({ event, id, payload });
};
const output = (id: string, text: string) => emit("pty-data", { id, data: btoa(text) });
Object.assign(window, { isTauri: query.get("native") === "1", __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, id: number) => listeners.get(event)?.delete(id) }, __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
  transformCallback: (handler: EventCallback) => { callbacks.set(++callbackId, handler); return callbackId; },
  unregisterCallback: (id: number) => callbacks.delete(id),
  convertFileSrc: (path: string) => path,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    rpc.push({ command, args });
    if (command === "plugin:event|listen") {
      const event = String(args?.event);
      const map = listeners.get(event) ?? new Map<number, number>();
      listeners.set(event, map); map.set(++listenerId, Number(args?.handler)); return listenerId;
    }
    if (command === "plugin:event|unlisten" || command === "fs_watch_set") return;
    if (command === "plugin:window|is_maximized" || command === "plugin:window|is_fullscreen") return false;
    if (command === "plugin:window|is_resizable") return true;
    if (command === "plugin:window|scale_factor") return 1;
    if (["plugin:window|start_dragging", "plugin:window|start_resize_dragging", "plugin:window|toggle_maximize", "plugin:window|minimize", "plugin:window|close"].includes(command)) return;
    if (command === "pty_spawn") {
      setTimeout(() => output(String(args?.id), "\x1b[32mwy@omnicode\x1b[0m ~/omnicode\r\n$ git status --short\r\n M src/workspace.ts\r\nM  README.md\r\n?? docs/layout.md\r\n\r\n$ "), 80);
      return;
    }
    if (command === "pty_status") return { foreground: null };
    if (command === "pty_write") { output(String(args?.id), String(args?.data)); return; }
    if (command === "pty_resize" || command === "pty_kill") return;
    if (command === "list_dir") return entries(String(args?.path));
    if (command === "read_text_file") return String(args?.path).endsWith(".json") ? '{\n  "name": "omnicode"\n}\n' : current;
    if (command === "stat_files") return (args?.paths as string[]).map(path => ({ path, mtimeMs: 1791891000000 }));
    if (command === "read_file_preview") return current.split("\n");
    if (command === "git_diff_index" || command === "git_diff_files") return index;
    if (command === "git_diff_stats") return { additions: index.additions, deletions: index.deletions, files: files.length };
    if (command === "git_file_diff" || command === "git_base_file_diff") return diff(String(args?.relative));
    if (command === "git_base_diff_files") return { base: "a1b2c3d", files };
    if (command === "git_history") return history;
    if (command === "git_pr_status") return null;
    if (command === "git_branches") return { current: "main", detached: false, branches: [{ name: "main", current: true, remote: null }] };
    if (command === "git_worktrees") return { defaultRoot: cwd, worktrees: [{ path: cwd, branch: "main", head: "a1b2c3d", isMain: !query.has("reviewResize"), locked: false, prunable: false, missing: false, dirty: true, unpushed: 0, sessionIds: [] }] };
    if (command === "session_checkpoint_status") return { files: [], undoLocked: false, workspaceShared: false };
    if (command === "chat_folders_list" || command === "list_skills" || command === "list_project_files") return [];
    if (command === "system_fonts") return { sans: [], mono: [] };
    if (/notification_preferences/.test(command)) return {};
    if (/list|recents|accounts|sessions|notifications/.test(command)) return [];
    if (/available|enabled|running/.test(command)) return false;
    throw new Error(`Offline tools fixture: ${command}`);
  },
} });

const session = { ...newSession("claude", cwd, "claude-sonnet"), id: "tools-session", title: "Refine the project workspace", blocks: [
  ...Array.from({ length: query.get("history") === "long" ? 60 : 0 }, (_, index) => ({
    id: `history-${index}`, role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    text: `Workspace history ${index}. ` + "Keep the terminal and editor available while reviewing the project. ".repeat(12),
  })),
  { id: "prompt", role: "user" as const, text: "Review the layout changes with the project tools visible." },
  { id: "reply", role: "assistant" as const, text: "The workspace keeps the conversation beside the changed files.\n\nThe file tree, review panel, and running terminal remain available while you work." },
] };
const source: FilePaneTab = { id: "tools-source", path: sourcePath, cwd };
const review: FilePaneTab = { id: "tools-review", path: sourcePath, cwd, review: true, changes: true, changeKind: "unstaged" };
const initialPane: EditorPane = { id: "tools-editor", files: [source, review], activeFileId: query.get("editor") === "source" ? source.id : review.id };
if (query.has("explorer")) initialPane.files.unshift({ id: "tools-explorer", path: cwd, cwd, explorer: true });
if (query.get("editor") === "terminal") {
  initialPane.files.push({ id: "tools-pane-pty", path: "omnicode", cwd, terminal: true });
  initialPane.activeFileId = "tools-pane-pty";
}
const initialDock: ProjectTerminalDock = { projectPath: cwd, side: "bottom", size: 220, open: true, pane: { id: "tools-terminal-pane", files: [{ id: "tools-pty", path: "omnicode", cwd, terminal: true }], activeFileId: "tools-pty" } };
const stackedTerminal: EditorPane = { id: "tools-stacked-terminal", files: [{ id: "tools-stacked-pty", path: "omnicode", cwd, terminal: true }], activeFileId: "tools-stacked-pty" };
const initialLayout: LayoutNode = { type: "split", id: "tools-split", dir: query.get("split") === "down" ? "down" : "right", children: [{ type: "leaf", id: session.id }, query.has("stackedTools") ? { type: "split", id: "stacked-tools", dir: "down", children: [{ type: "leaf", id: initialPane.id }, { type: "leaf", id: stackedTerminal.id }], sizes: [0.5, 0.5] } : { type: "leaf", id: initialPane.id }], sizes: [0.54, 0.46] };

function DesktopToolsFixture() {
  const [workspaceTab, setWorkspaceTab] = useState(() => ({ ...newTab(session.id), layout: initialLayout }));
  const layout = workspaceTab.layout;
  const [sessionHeaderHost, setSessionHeaderHost] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<SidebarProps["tab"]>("files");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pane, setPane] = useState(initialPane);
  const [dock, setDock] = useState(initialDock);
  const [pool] = useState(() => new TranscriptPool());
  const [focusedId, setFocusedId] = useState(session.id);
  useEffect(() => {
    Object.assign(window, { toolsFixture: { readTerminal, setTab, setSidebarOpen, setTerminalOpen: (open: boolean) => setDock(value => ({ ...value, open })), selectFile: (activeFileId: string) => setPane(value => ({ ...value, activeFileId })), rpc, output: (text: string, id = "tools-pty") => output(id, text) } });
  }, []);
  const activity = { cwd, recents: [{ path: cwd, openedAt: 1791891000000 }], onSearch: noop, onOpenInbox: noop, onOpenNotes: noop, onOpenAutomations: noop, onOpenWorkflows: noop, onOpenSettings: noop, notesEnabled: true };
  const openFile = (path: string) => setPane(value => ({ ...value, activeFileId: source.id, files: value.files.map(file => file.id === source.id ? { ...file, path } : file) }));
  const sidebar: SidebarProps = { desktopMode: "code", cwd, recents: activity.recents, open: true, sessions: [{ id: session.id, cwd, harness: session.harness, model: session.model, runtimeMode: session.runtimeMode, title: session.title, createdAt: 1791891000000, updatedAt: 1791891000000 }], busySessionIds: new Set(), approvalSessionIds: new Set(), activeSessionId: session.id, visibleSessionId: session.id, status: "idle", pending: false, onSelectSession: noop, tab, onTabChange: setTab, filesSearchOpen: false, onFilesSearchOpenChange: noop, onOpenFile: openFile, onOpenDiff: () => setPane(value => ({ ...value, activeFileId: review.id })), textHarness: "claude", onOpenTerminal: () => setDock(value => ({ ...value, open: true })), selectedDiffPath: sourcePath, selectedDiffKind: "unstaged" };
  const handlers = {
    onClose: noop, onCwdChange: noop, onBranchChange: noop, onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop, onModelChange: noop, onModelSettingsChange: noop,
    onRuntimeModeChange: noop, onSaveDraft: noop, onRemoveDraft: noop,
    onDeleteQueuedMessage: noop, onEditQueuedMessage: noop, onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop, onResumeQueue: noop, onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop, onUsageLimitDismiss: noop, onApproval: noop,
    onQuestionReply: noop, onOpenSessionFile: noop, onOpenPlan: noop, onUpdatePlan: noop,
    onBuildPlan: noop, onMovePane: (from: string, to: string, edge: PaneEdge) => setWorkspaceTab(value => moveTabPane(value, from, to, edge)), onCloseFile: noop, onCloseOtherFiles: noop,
    onReorderFiles: noop, onFileDirtyChange: noop, onFileErrorCountChange: noop,
    onRatio: (splitId: string, index: number, ratio: number) => setWorkspaceTab(value => ({ ...value, layout: setSplitRatio(value.layout, splitId, index, ratio) })),
  };
  const paneProps: ComponentProps<typeof PaneTree> = { ...handlers, visible: true, layout, sessions: [session], editorPanes: [pane, ...(query.has("stackedTools") ? [stackedTerminal] : [])], dirtyFileIds: new Set(), fileErrorCounts: new Map(), focusedId, surfaceMode: "split", composerFocused: false, recents: activity.recents, transcriptPool: pool, hideProjectPicker: false, onFocus: setFocusedId, onSubmit: () => true, onStop: noop, onCompactContext: () => true, onOpenFile: openFile, onOpenDiff: () => setPane(value => ({ ...value, activeFileId: review.id })), onNewTerminal: () => setDock(value => ({ ...value, open: true })), onSelectFile: (_pane: string, activeFileId: string) => setPane(value => ({ ...value, activeFileId })), autoArrangeTools: workspaceTab.autoArrangeTools, onFitLayout: (previous, next) => setWorkspaceTab(value => value.layout === previous ? { ...value, layout: next } : value) };
  const titlebar = <DesktopTitlebarNavigation menu={<WindowMenuButton handlers={{ "Tab: New": noop }} dispatch={() => true} />} modeToggle={<DesktopModeToggle mode="code" onChange={noop} />} canGoBack onGoBack={noop} panelActive={sidebarOpen} onTogglePanel={() => setSidebarOpen(value => !value)} />;
  const headerActions: SessionHeaderActions = {
    rename: noop, archive: noop, splitRight: noop,
    terminalAvailable: true, terminalOpen: dock.open,
    toggleTerminal: () => setDock(value => ({ ...value, open: !value.open })),
    filesSessionId: tab === "files" ? session.id : undefined,
    toggleFiles: sessionId => { setFocusedId(sessionId); setTab(value => value === "files" ? "sessions" : "files"); },
    changesOpen: false, toggleChanges: noop,
  };
  return <MotionConfig reducedMotion="user"><SessionHeaderActionsContext.Provider value={headerActions}><div className="app-shell-root desktop-workspace" data-desktop-mode="code" data-tools-fixture style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <WindowDragBar windowNavigation={titlebar} windowLeading={<div ref={setSessionHeaderHost} data-window-session-header className="min-w-0 flex-1" />} />
    <div className="flex min-h-0 min-w-0 flex-1">
    <SidebarRail open={!sidebarOpen}><ActivityBar layout="rail" chromeInMenuBar {...activity} /></SidebarRail>
    <Sidebar {...sidebar} tab="sessions" open={sidebarOpen} onToggleSidebar={() => setSidebarOpen(value => !value)} chromeInMenuBar navigation={{ primary: <DesktopNewSessionAction mode="code" onNew={noop} />, scrollable: <DesktopNavigation onProjects={noop} projectsActive={false} onBots={noop} botsActive={false} activity={activity} /> }} footer={<ActivityBar layout="sidebar-footer" {...activity} />} />
    <SidebarMain open={sidebarOpen}>
      <main className="desktop-workspace flex min-h-0 min-w-0 flex-1">
        <WorkspaceToolsDock sidebar={sidebar} visible>
          <TerminalDockLayout projectTerminals={[dock]} currentDock={dock} projectCwd={cwd} workspaceVisible lastDockSide="bottom" focused={focusedId === dock.pane.id} onFocus={() => setFocusedId(dock.pane.id)} onHide={() => setDock(value => ({ ...value, open: false }))} onSideChange={side => setDock(value => ({ ...value, side }))} onSizeCommit={size => setDock(value => ({ ...value, size }))} onAddTerminal={noop} onSelectTerminal={noop} onCloseTerminal={noop} onCloseOtherTerminals={noop} onReorderTerminals={noop}>
            <div className="relative flex min-h-0 min-w-0 flex-row" style={{ gridArea: "main" }}>
              <div className="relative min-h-0 min-w-0 flex-1">
                <div data-workspace-tab="tools-tab" data-active="true" className="absolute inset-0 flex h-full min-h-0 flex-col">
                  <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col"><SurfaceVisibilityContext.Provider value><PaneTree {...paneProps} sessionHeaderHost={sessionHeaderHost} /></SurfaceVisibilityContext.Provider></div>
                </div>
              </div>
            </div>
          </TerminalDockLayout>
        </WorkspaceToolsDock>
      </main>
    </SidebarMain>
    </div>
    <TranscriptPoolOutlet pool={pool} />
    <WindowResizeObserver />
    <WindowResizeHandles />
  </div></SessionHeaderActionsContext.Provider></MotionConfig>;
}

createRoot(document.getElementById("root")!).render(<DesktopToolsFixture />);
