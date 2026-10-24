import type { GitFileDiffKind } from "../../../contracts/workspace";
import type { ReleaseNotesTabSource } from "../../../shared/lib/releaseNotes";

import { applyTerminalMeta, defaultTerminalTitle, type TerminalMetaPatch } from "../../terminal/model/terminalTab";
import type { HarnessId } from "../../../contracts/session";
import type { WorkflowAgentAvatar } from "../../workflows/model/workflowAgentAvatar";
import type { WorkflowRunArtifactKind } from "../../../integrations/workflow/protocol/workflow-artifacts";
import { pathKey } from "../../../shared/lib/paths";

/**
 * Split tree for a tab. Same-direction splits share a group so
 * new panes divide space equally until the user drags a sash.
 * Panes can be dragged onto another pane's edge: same-axis
 * siblings reorder, a perpendicular edge nests a new split, and
 * a drop in another group relocates the leaf there. Session cards
 * from the sidebar use the same edges to open or move a chat into
 * that pane. cmd-d splits right, shift-cmd-d splits down,
 * cmd-opt-arrows move focus to the adjacent pane.
 */

export type SplitDir = "right" | "down";
export type FocusDir = "left" | "right" | "up" | "down";

export type LayoutNode =
  | { type: "leaf"; id: string }
  | {
      type: "split";
      id: string;
      dir: SplitDir;
      children: LayoutNode[];
      sizes: number[];
    };

export type PlanTabSource = {
  sessionId: string;
  blockId: string;
  title: string;
};

export type CommitTabSource = {
  sha: string;
  shortSha: string;
  subject: string;
};

/** One orchestration worker, opened for inspection beside its lead. */
export type AgentTabSource = {
  sessionId: string;
  leadId: string;
  harness: HarnessId;
};

/** A provider subagent stored inside its parent conversation. */
export type SubagentTabSource = {
  parentSessionId: string;
  path: string[];
  harness: HarnessId;
};

/** A dynamic workflow run's detail view, opened beside its conversation. */
export type WorkflowRunTabSource = {
  runId: string;
  /** The launching conversation (desktop session id). */
  parentSessionId: string;
  /** The run-card block id the run's graph hangs on. */
  toolCallId?: string;
  workflowName?: string;
};

/** A workflow subagent's hidden Host session, watched read-only. */
export type WorkflowAgentTabSource = {
  sessionId: string;
  parentSessionId: string;
  runId: string;
  avatar?: WorkflowAgentAvatar;
};

export type WorkflowArtifactTabSource = {
  parentSessionId: string;
  runId: string;
  artifactId: string;
  kind?: WorkflowRunArtifactKind;
  contentType?: string;
  sourcePath?: string;
};

export type SessionChangesSource = {
  sessionId: string;
  turnId?: string;
};

export const APP_VIEW_KINDS = [
  "settings",
  "search",
  "inbox",
  "notes",
  "automations",
  "workflows",
  "assistant",
  "projects",
] as const;

export type AppViewKind = (typeof APP_VIEW_KINDS)[number];

/** These destinations replace the workspace instead of becoming documents. */
export const APP_PAGE_KINDS = ["notes", "inbox", "automations", "workflows", "projects"] as const;
export type AppPageKind = (typeof APP_PAGE_KINDS)[number];
export function isAppPageKind(kind: AppViewKind): kind is AppPageKind {
  return (APP_PAGE_KINDS as readonly AppViewKind[]).includes(kind);
}

export function appViewTitle(kind: AppViewKind): string {
  return {
    settings: "Settings",
    search: "Search",
    inbox: "Inbox",
    notes: "Notes",
    automations: "Automations",
    workflows: "Workflows",
    assistant: "Bots",
    projects: "Projects",
  }[kind];
}

export type FilePaneTab = {
  id: string;
  path: string;
  cwd: string;
  /** Owning project when cwd points at one of its linked worktrees. */
  projectCwd?: string;
  /** Application-owned view, unique by kind within its chat workspace. */
  appView?: { kind: AppViewKind };
  /** Persistent file browser, retained when its last document closes. */
  explorer?: boolean;
  /** Chat whose header Files/Terminal toggle opened this explorer or terminal. */
  ownerSessionId?: string;
  plan?: PlanTabSource;
  releaseNotes?: ReleaseNotesTabSource;
  review?: boolean;
  /** The one review per working copy: every change, with source control beside it. */
  changes?: boolean;
  /** Which side of a staged/unstaged path was selected in source control. */
  changeKind?: GitFileDiffKind;
  /** The session whose captured snapshots the review opened on, if any. */
  sessionChanges?: SessionChangesSource;
  /** Historical commit review (unified diff, read-only). */
  commit?: CommitTabSource;
  /** Read-only transcript of an orchestration worker. Live only — not persisted. */
  agent?: AgentTabSource;
  subagent?: SubagentTabSource;
  workflowRun?: WorkflowRunTabSource;
  workflowAgent?: WorkflowAgentTabSource;
  workflowArtifact?: WorkflowArtifactTabSource;
  terminal?: boolean;
  /** Foreground command when it isn't the shell. Live only — not persisted. */
  foreground?: string;
  /** Temporary tab: the next preview open in its pane replaces it. */
  preview?: boolean;
};

export type EditorPane = {
  id: string;
  files: FilePaneTab[];
  activeFileId: string;
};

export type SurfaceKind = "editor" | "terminal";

export type WorkspaceTab = {
  kind: "session";
  id: string;
  layout: LayoutNode;
  focusedId: string;
  editorPanes: EditorPane[];
  terminalPanes: EditorPane[];
  diffOpen?: boolean;
  diffFocused?: boolean;
  /** Show documents beside chat, or use one tab strip for chat and documents. */
  surfaceMode?: "split" | "unified";
  /** Explicit panel placement keeps its split directions during width fitting. */
  autoArrangeTools?: boolean;
  /** Explicit tab group; absent means ungrouped. */
  groupId?: string;
};

const MIN_SIZE = 0.08;

export function leaf(sessionId: string): LayoutNode {
  return { type: "leaf", id: sessionId };
}

export function newTab(sessionId: string): WorkspaceTab {
  return {
    kind: "session",
    id: crypto.randomUUID(),
    layout: leaf(sessionId),
    focusedId: sessionId,
    editorPanes: [],
    terminalPanes: [],
  };
}

/** Keep the tab's identity and group; replace its contents with one session leaf. */
export function resetTabToSession(
  tab: WorkspaceTab,
  sessionId: string,
): WorkspaceTab {
  const { surfaceMode: _surfaceMode, autoArrangeTools: _autoArrangeTools, ...rest } = tab;
  return {
    ...rest,
    layout: leaf(sessionId),
    focusedId: sessionId,
    editorPanes: [],
    terminalPanes: [],
    diffOpen: false,
    diffFocused: false,
  };
}

export function newFileTab(
  path: string,
  cwd: string,
  review = false,
  changeKind?: GitFileDiffKind,
  projectCwd?: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path,
    cwd,
    ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
    ...(review ? { review: true } : {}),
    ...(changeKind ? { changeKind } : {}),
  };
}

export function newChangesTab(
  cwd: string,
  focusPath?: string,
  focusKind?: GitFileDiffKind,
  projectCwd?: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: focusPath || cwd,
    cwd,
    ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
    review: true,
    changes: true,
    ...(focusKind ? { changeKind: focusKind } : {}),
  };
}

export function newSessionChangesTab(
  cwd: string,
  sessionId: string,
  focusPath?: string,
  projectCwd?: string,
  turnId?: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: focusPath || cwd,
    cwd,
    ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
    review: true,
    changes: true,
    sessionChanges: { sessionId, ...(turnId ? { turnId } : {}) },
  };
}

export function newCommitTab(
  cwd: string,
  commit: CommitTabSource,
  projectCwd?: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: `commit:${commit.sha}`,
    cwd,
    ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
    commit,
  };
}

export function newPlanTab(
  sessionId: string,
  blockId: string,
  title: string,
  cwd: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: `plan:${blockId}`,
    cwd,
    plan: { sessionId, blockId, title },
  };
}

export function newReleaseNotesWorkspaceTab(
  releaseNotes: ReleaseNotesTabSource,
): WorkspaceTab {
  const file: FilePaneTab = {
    id: crypto.randomUUID(),
    path: `release-notes:${releaseNotes.version}`,
    cwd: "~",
    releaseNotes,
  };
  const pane = newEditorPane(file);
  return {
    kind: "session",
    id: crypto.randomUUID(),
    layout: leaf(pane.id),
    focusedId: pane.id,
    editorPanes: [pane],
    terminalPanes: [],
  };
}

/** Create a top-level workspace tab whose first and only pane is this file. */
export function newEditorWorkspaceTab(file: FilePaneTab): WorkspaceTab {
  const pane = newEditorPane(file);
  return {
    kind: "session",
    id: crypto.randomUUID(),
    layout: leaf(pane.id),
    focusedId: pane.id,
    editorPanes: [pane],
    terminalPanes: [],
  };
}

export function newAppViewWorkspaceTab(kind: AppViewKind): WorkspaceTab {
  return newEditorWorkspaceTab({
    id: crypto.randomUUID(),
    path: `app:${kind}`,
    cwd: "~",
    appView: { kind },
  });
}

/** Open a permanent app view owned by this chat, reusing only its own view. */
export function openSessionAppView(
  tab: WorkspaceTab,
  kind: AppViewKind,
): WorkspaceTab {
  return openEditorTab(
    tab,
    {
      id: crypto.randomUUID(),
      path: `app:${kind}`,
      cwd: "~",
      appView: { kind },
    },
    { pin: true },
  );
}

/** Locate a view across all projects, tabs and panes in this window. */
export function findAppViewTab(
  tabs: readonly WorkspaceTab[],
  kind: AppViewKind,
): { tab: WorkspaceTab; pane: EditorPane; file: FilePaneTab } | undefined {
  for (const tab of tabs) {
    for (const pane of tab.editorPanes) {
      const file = pane.files.find((entry) => entry.appView?.kind === kind);
      if (file) return { tab, pane, file };
    }
  }
  return undefined;
}

/** Focus the window's existing view, or create its standalone workspace tab. */
export function openAppViewTab(
  tabs: WorkspaceTab[],
  kind: AppViewKind,
): { tabs: WorkspaceTab[]; tabId: string; paneId: string } {
  const existing = findAppViewTab(tabs, kind);
  if (existing) {
    return {
      tabs: tabs.map((tab) =>
        tab === existing.tab
          ? openEditorTab(tab, existing.file, { pin: true })
          : tab,
      ),
      tabId: existing.tab.id,
      paneId: existing.pane.id,
    };
  }
  const created = newAppViewWorkspaceTab(kind);
  return {
    tabs: [...tabs, created],
    tabId: created.id,
    paneId: created.focusedId,
  };
}

/** Only app views: this tab has no project and is visible in each project. */
export function isAppViewOnlyTab(tab: WorkspaceTab): boolean {
  const ids = leafIds(tab.layout);
  return (
    tab.editorPanes.length > 0 &&
    (tab.terminalPanes ?? []).length === 0 &&
    ids.every((id) => tab.editorPanes.some((pane) => pane.id === id)) &&
    tab.editorPanes.every(
      (pane) => pane.files.length > 0 && pane.files.every(isAppViewTab),
    )
  );
}

/** The file of a top-level tab that holds nothing but one preview file. */
export function previewWorkspaceFile(
  tab: WorkspaceTab,
): FilePaneTab | undefined {
  const [pane] = tab.editorPanes;
  if (
    tab.layout.type !== "leaf" ||
    tab.layout.id !== pane?.id ||
    tab.editorPanes.length !== 1 ||
    (tab.terminalPanes ?? []).length > 0 ||
    pane.files.length !== 1
  ) {
    return undefined;
  }
  return pane.files[0].preview ? pane.files[0] : undefined;
}

/**
 * Workspace file-tab mode: focus the tab already showing `file`, else reuse
 * the project's preview tab, else insert `created`. Pure over `tabs` so it
 * runs inside a state updater and sees opens that have not rendered yet.
 */
export function openWorkspaceFile(
  tabs: WorkspaceTab[],
  file: FilePaneTab,
  created: WorkspaceTab,
  insert: (tabs: WorkspaceTab[], tab: WorkspaceTab) => WorkspaceTab[],
  pin = false,
): { tabs: WorkspaceTab[]; tabId: string; paneId?: string } {
  const key = editorTabKey(file);
  const project = pathKey(file.projectCwd ?? file.cwd);
  const existing = tabs
    .flatMap((tab) => tab.editorPanes.map((pane) => ({ tab, pane })))
    .find(({ pane }) => pane.files.some((open) => editorTabKey(open) === key));
  const hit =
    existing?.tab ??
    (pin
      ? undefined
      : tabs.find((tab) => {
          const open = previewWorkspaceFile(tab);
          return !!open && pathKey(open.projectCwd ?? open.cwd) === project;
        }));
  if (!hit) return { tabs: insert(tabs, created), tabId: created.id };
  return {
    tabs: tabs.map((tab) =>
      tab === hit ? openEditorTab(tab, file, { pin }) : tab,
    ),
    tabId: hit.id,
    paneId: existing?.pane.id ?? hit.editorPanes[0].id,
  };
}

/** `path` carries the label: an agent tab has no file behind it. */
export function newAgentTab(
  title: string,
  cwd: string,
  agent: AgentTabSource,
): FilePaneTab {
  return { id: crypto.randomUUID(), path: title, cwd, agent };
}

export function newWorkflowRunTab(title: string, cwd: string, workflowRun: WorkflowRunTabSource): FilePaneTab {
  return { id: crypto.randomUUID(), path: title, cwd, workflowRun };
}

export function newSubagentTab(title: string, cwd: string, subagent: SubagentTabSource): FilePaneTab {
  return { id: crypto.randomUUID(), path: title, cwd, subagent };
}

export function newWorkflowAgentTab(title: string, cwd: string, workflowAgent: WorkflowAgentTabSource): FilePaneTab {
  return { id: crypto.randomUUID(), path: title, cwd, workflowAgent };
}

export function newWorkflowArtifactTab(title: string, cwd: string, workflowArtifact: WorkflowArtifactTabSource): FilePaneTab {
  return { id: crypto.randomUUID(), path: title, cwd, workflowArtifact };
}

export function newTerminalFile(
  cwd: string,
  title?: string,
  projectCwd?: string,
): FilePaneTab {
  return {
    id: crypto.randomUUID(),
    path: title ?? defaultTerminalTitle(cwd),
    cwd,
    ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
    terminal: true,
  };
}

export function newTerminalWorkspaceTab(file: FilePaneTab): WorkspaceTab {
  const pane = newEditorPane(file);
  return {
    kind: "session",
    id: crypto.randomUUID(),
    layout: leaf(pane.id),
    focusedId: pane.id,
    editorPanes: [],
    terminalPanes: [pane],
  };
}

export function nextTerminalTitleFromFiles(
  files: Iterable<FilePaneTab>,
  cwd: string,
): string {
  const base = defaultTerminalTitle(cwd);
  const taken = new Set<string>();
  for (const file of files) {
    if (isTerminalTab(file)) taken.add(file.path);
  }
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function nextTerminalTitle(tab: WorkspaceTab, cwd: string): string {
  return nextTerminalTitleFromFiles(
    (tab.terminalPanes ?? []).flatMap((pane) => pane.files),
    cwd,
  );
}

export function updateTerminalTab(
  tab: WorkspaceTab,
  fileId: string,
  patch: TerminalMetaPatch,
): WorkspaceTab {
  const panes = tab.terminalPanes ?? [];
  let changed = false;
  const terminalPanes = panes.map((pane) => {
    const files = pane.files.map((file) => {
      if (!file.terminal || file.id !== fileId) return file;
      const next = applyTerminalMeta(file, patch);
      if (next !== file) changed = true;
      return next;
    });
    return files === pane.files ? pane : { ...pane, files };
  });
  if (!changed) return tab;
  return withSurfacePanes(tab, "terminal", terminalPanes);
}

export function surfacePanes(
  tab: WorkspaceTab,
  kind: SurfaceKind,
): EditorPane[] {
  return kind === "editor" ? tab.editorPanes : (tab.terminalPanes ?? []);
}

export function withSurfacePanes(
  tab: WorkspaceTab,
  kind: SurfaceKind,
  panes: EditorPane[],
): WorkspaceTab {
  return kind === "editor"
    ? { ...tab, editorPanes: panes }
    : { ...tab, terminalPanes: panes };
}

export function findSurfacePane(
  tab: WorkspaceTab,
  paneId: string,
): { kind: SurfaceKind; pane: EditorPane } | undefined {
  const editor = tab.editorPanes.find((pane) => pane.id === paneId);
  if (editor) return { kind: "editor", pane: editor };
  const terminal = (tab.terminalPanes ?? []).find((pane) => pane.id === paneId);
  if (terminal) return { kind: "terminal", pane: terminal };
}

export function isPlanTab(
  file: FilePaneTab,
): file is FilePaneTab & { plan: PlanTabSource } {
  return !!file.plan;
}

export function isAppViewTab(
  file: FilePaneTab,
): file is FilePaneTab & { appView: { kind: AppViewKind } } {
  return !!file.appView;
}

export function isReleaseNotesTab(
  file: FilePaneTab,
): file is FilePaneTab & { releaseNotes: ReleaseNotesTabSource } {
  return !!file.releaseNotes;
}

export function isCommitTab(
  file: FilePaneTab,
): file is FilePaneTab & { commit: CommitTabSource } {
  return !!file.commit;
}

export function isTerminalTab(file: FilePaneTab): boolean {
  return !!file.terminal;
}

export function isAgentTab(
  file: FilePaneTab,
): file is FilePaneTab & { agent: AgentTabSource } {
  return !!file.agent;
}

export function isWorkflowRunTab(file: FilePaneTab): file is FilePaneTab & { workflowRun: WorkflowRunTabSource } {
  return !!file.workflowRun;
}

export function isSubagentTab(file: FilePaneTab): file is FilePaneTab & { subagent: SubagentTabSource } {
  return !!file.subagent;
}

export function isWorkflowAgentTab(file: FilePaneTab): file is FilePaneTab & { workflowAgent: WorkflowAgentTabSource } {
  return !!file.workflowAgent;
}

export function isWorkflowArtifactTab(file: FilePaneTab): file is FilePaneTab & { workflowArtifact: WorkflowArtifactTabSource } {
  return !!file.workflowArtifact;
}

export function isVirtualDocumentTab(file: FilePaneTab): boolean {
  return (
    !!file.explorer ||
    isWorkflowRunTab(file) ||
    isSubagentTab(file) ||
    isWorkflowAgentTab(file) ||
    isWorkflowArtifactTab(file) ||
    isAppViewTab(file) ||
    isPlanTab(file) ||
    isReleaseNotesTab(file) ||
    isCommitTab(file) ||
    isAgentTab(file)
  );
}

export function isFilesystemTab(file: FilePaneTab): boolean {
  return (
    !isTerminalTab(file) && !isVirtualDocumentTab(file) && !file.sessionChanges
  );
}

export function focusedFileTab(tab: WorkspaceTab): FilePaneTab | undefined {
  const pane =
    tab.editorPanes.find((entry) => entry.id === tab.focusedId) ??
    (tab.terminalPanes ?? []).find((entry) => entry.id === tab.focusedId);
  return pane?.files.find((file) => file.id === pane.activeFileId);
}

/** Move terminal tabs out of file panes so the two never share a tab strip. */
export function isolateTerminalPanes(tab: WorkspaceTab): WorkspaceTab {
  const existingTerminals = tab.terminalPanes ?? [];
  const mixed = tab.editorPanes.some((pane) => pane.files.some(isTerminalTab));
  if (!mixed && tab.terminalPanes) return tab;

  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  const terminalPanes = [...existingTerminals];

  for (const pane of tab.editorPanes) {
    const files = pane.files.filter((file) => !isTerminalTab(file));
    const terminals = pane.files.filter(isTerminalTab);
    if (files.length > 0) {
      editorPanes.push({
        ...pane,
        files,
        activeFileId: files.some((file) => file.id === pane.activeFileId)
          ? pane.activeFileId
          : files[0].id,
      });
    }
    if (terminals.length === 0) continue;
    if (files.length === 0) {
      terminalPanes.push({ ...pane, files: terminals });
      continue;
    }
    const split: EditorPane = {
      id: crypto.randomUUID(),
      files: terminals,
      activeFileId: terminals.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : terminals[0].id,
    };
    terminalPanes.push(split);
    layout = splitPane(layout, pane.id, "down", split.id);
    if (pane.id === tab.focusedId && split.activeFileId === pane.activeFileId) {
      focusedId = split.id;
    }
  }

  return { ...tab, layout, focusedId, editorPanes, terminalPanes };
}

export function isReviewTab(file: FilePaneTab): boolean {
  return !!file.review && !isVirtualDocumentTab(file);
}

export function isChangesTab(file: FilePaneTab): boolean {
  return !!file.changes && isReviewTab(file);
}

export function isSessionChangesTab(
  file: FilePaneTab,
): file is FilePaneTab & { sessionChanges: SessionChangesSource } {
  return !!file.sessionChanges && isReviewTab(file);
}

export function editorTabKey(file: FilePaneTab): string {
  if (file.explorer)
    return file.ownerSessionId
      ? `explorer:${file.ownerSessionId}:${file.cwd}`
      : `explorer:${file.cwd}`;
  if (file.appView) return `app:${file.appView.kind}`;
  if (file.terminal) return `terminal:${file.id}`;
  if (file.agent) return `agent:${file.agent.sessionId}`;
  if (file.subagent) return `subagent:${JSON.stringify([file.subagent.parentSessionId, file.subagent.path])}`;
  if (file.workflowRun) return `workflow-run:${file.workflowRun.runId}`;
  if (file.workflowAgent) return `workflow-agent:${file.workflowAgent.sessionId}`;
  if (file.workflowArtifact) return `workflow-artifact:${JSON.stringify([file.cwd, file.workflowArtifact.parentSessionId, file.workflowArtifact.runId, file.workflowArtifact.artifactId])}`;
  if (file.plan) return `plan:${file.plan.blockId}`;
  if (file.releaseNotes) return `release-notes:${file.releaseNotes.version}`;
  if (file.commit) return `commit:${file.cwd}:${file.commit.sha}`;
  // Session and working-tree changes share one review per working copy.
  if (file.changes) return `changes:${file.cwd}`;
  if (file.sessionChanges)
    return `session-changes:${file.cwd}:${file.sessionChanges.sessionId}${file.sessionChanges.turnId ? `:${file.sessionChanges.turnId}` : ""}`;
  return file.review ? `review:${file.path}` : `file:${file.path}`;
}

export function newEditorPane(file: FilePaneTab): EditorPane {
  return {
    id: crypto.randomUUID(),
    files: [file],
    activeFileId: file.id,
  };
}

export type OpenEditorTabOptions = {
  /** Which side of the focused non-editor pane receives a new editor pane. */
  split?: "left" | "right";
  /** Open (or promote an existing tab) as permanent instead of preview. */
  pin?: boolean;
  /** Insert a new tab immediately after this file, in the same editor pane. */
  afterFileId?: string;
};

/** Tabs opened by browsing lists: files, per-file diffs, commits, session diffs. */
export function isPreviewableTab(file: FilePaneTab): boolean {
  return (
    !file.explorer &&
    !file.appView &&
    !file.terminal &&
    !file.agent &&
    !file.subagent &&
    !file.workflowRun &&
    !file.workflowAgent &&
    !file.workflowArtifact &&
    !file.plan &&
    !file.releaseNotes &&
    !file.changes
  );
}

function withoutPreview(file: FilePaneTab): FilePaneTab {
  if (!file.preview) return file;
  const { preview: _preview, ...rest } = file;
  return rest;
}

/** Make a preview tab permanent. Returns `tab` unchanged when nothing matched. */
export function pinEditorFile(tab: WorkspaceTab, fileId: string): WorkspaceTab {
  let changed = false;
  const editorPanes = tab.editorPanes.map((pane) => {
    const file = pane.files.find((entry) => entry.id === fileId);
    if (!file?.preview) return pane;
    changed = true;
    return {
      ...pane,
      files: pane.files.map((entry) =>
        entry === file ? withoutPreview(entry) : entry,
      ),
    };
  });
  return changed ? { ...tab, editorPanes } : tab;
}

/** Focus an existing editor tab, or open it in the focused editor pane / a new split. */
export function openEditorTab(
  tab: WorkspaceTab,
  file: FilePaneTab,
  options: OpenEditorTabOptions = {},
): WorkspaceTab {
  if (file.terminal) return openTerminalTab(tab, file);
  tab = isolateTerminalPanes(tab);
  // Older workflow tabs may still carry the preview flag. Promote them before
  // opening anything else so a file preview cannot replace their contents.
  tab = {
    ...tab,
    editorPanes: tab.editorPanes.map((pane) =>
      pane.files.some(
        (entry) => entry.preview && (entry.workflowRun || entry.workflowAgent || entry.workflowArtifact),
      )
        ? {
            ...pane,
            files: pane.files.map((entry) =>
              entry.workflowRun || entry.workflowAgent || entry.workflowArtifact
                ? withoutPreview(entry)
                : entry,
            ),
          }
        : pane,
    ),
  };

  const key = editorTabKey(file);
  const existingPane = tab.editorPanes.find((pane) =>
    pane.files.some((entry) => editorTabKey(entry) === key),
  );
  const existingFile = existingPane?.files.find(
    (entry) => editorTabKey(entry) === key,
  );
  if (existingPane && existingFile) {
    return {
      ...tab,
      focusedId: existingPane.id,
      diffFocused: false,
      editorPanes: tab.editorPanes.map((pane) =>
        pane.id === existingPane.id
          ? {
              ...pane,
              files: options.pin
                ? pane.files.map((entry) =>
                    entry === existingFile
                      ? {
                          ...withoutPreview(entry),
                          ...(file.review
                            ? { changeKind: file.changeKind }
                            : {}),
                        }
                      : entry,
                  )
                : file.review
                  ? pane.files.map((entry) =>
                      entry === existingFile
                        ? { ...entry, changeKind: file.changeKind }
                        : entry,
                    )
                  : pane.files,
              activeFileId: existingFile.id,
            }
          : pane,
      ),
    };
  }

  file =
    isPreviewableTab(file) && !options.pin
      ? { ...file, preview: true }
      : withoutPreview(file);
  const focusedPane = tab.editorPanes.find((pane) => pane.id === tab.focusedId);
  const acceptsFile = (pane: EditorPane) =>
    !file.explorer &&
    (!pane.files.some((entry) => entry.explorer) ||
      (isFilesystemTab(file) && !isReviewTab(file) &&
        pane.files.some((entry) => entry.explorer && entry.cwd === file.cwd))) &&
    !pane.files.some(
      (entry) => entry.id === pane.activeFileId && isAppViewTab(entry),
    );
  const targetPane =
    tab.editorPanes.find((pane) =>
      acceptsFile(pane) &&
      pane.files.some((entry) => entry.id === options.afterFileId),
    ) ??
    (focusedPane && acceptsFile(focusedPane) ? focusedPane : undefined) ??
    tab.editorPanes.find(acceptsFile);
  if (targetPane) {
    const sourceIndex = targetPane.files.findIndex(
      (entry) => entry.id === options.afterFileId,
    );
    const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : targetPane.files.length;
    const previewIndex = file.preview
      ? targetPane.files.findIndex((entry) => entry.preview)
      : -1;
    const files =
      previewIndex >= 0
        ? targetPane.files.map((entry, index) =>
            index === previewIndex ? file : entry,
          )
        : [
            ...targetPane.files.slice(0, insertAt),
            file,
            ...targetPane.files.slice(insertAt),
          ];
    return {
      ...tab,
      focusedId: targetPane.id,
      diffFocused: false,
      editorPanes: tab.editorPanes.map((pane) =>
        pane.id === targetPane.id
          ? {
              ...pane,
              files,
              activeFileId: file.id,
            }
          : pane,
      ),
    };
  }

  const editorPane = newEditorPane(file);
  // Documents join the card stack beside chat: above an open terminal card.
  const terminalCard = tab.terminalPanes.find((pane) =>
    leafIds(tab.layout).includes(pane.id),
  );
  return {
    ...tab,
    layout: terminalCard
      ? splitPaneRelative(
          tab.layout,
          terminalCard.id,
          "down",
          editorPane.id,
          true,
        )
      : splitPaneRelative(
          tab.layout,
          tab.focusedId,
          "right",
          editorPane.id,
          options.split === "left",
        ),
    focusedId: editorPane.id,
    diffFocused: false,
    editorPanes: [...tab.editorPanes, editorPane],
  };
}

/** The browser owns normal documents; reviews keep their own pane. */
/**
 * A chat's own header tools: the explorer and terminal panes it opened. Each
 * chat in a split toggles only these, never another chat's.
 */
export function sessionToolPanes(
  tab: WorkspaceTab,
  sessionId: string,
  tool: "files" | "terminal",
): EditorPane[] {
  const placed = new Set(leafIds(tab.layout));
  const panes = tool === "files" ? tab.editorPanes : (tab.terminalPanes ?? []);
  return panes.filter(
    (pane) =>
      placed.has(pane.id) &&
      pane.files.some(
        (file) =>
          file.ownerSessionId === sessionId &&
          (tool === "files" ? file.explorer : file.terminal),
      ),
  );
}

/** Chats in this tab whose own explorer or terminal is showing. */
export function sessionsWithToolPanes(
  tab: WorkspaceTab | undefined,
  tool: "files" | "terminal",
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!tab) return ids;
  const placed = new Set(leafIds(tab.layout));
  const panes = tool === "files" ? tab.editorPanes : (tab.terminalPanes ?? []);
  for (const pane of panes) {
    if (!placed.has(pane.id)) continue;
    for (const file of pane.files) {
      if (file.ownerSessionId && (tool === "files" ? file.explorer : file.terminal))
        ids.add(file.ownerSessionId);
    }
  }
  return ids;
}

export function openFileExplorer(
  tab: WorkspaceTab,
  cwd: string,
  projectCwd?: string,
  ownerSessionId?: string,
): WorkspaceTab {
  const existing = tab.editorPanes.find((pane) =>
    pane.files.some((file) =>
      file.explorer &&
      file.cwd === cwd &&
      (!ownerSessionId || file.ownerSessionId === ownerSessionId),
    ),
  );
  if (existing) return { ...tab, focusedId: existing.id, diffFocused: false };
  const browser: FilePaneTab = {
    ...newFileTab(cwd, cwd, false, undefined, projectCwd),
    explorer: true,
    ...(ownerSessionId ? { ownerSessionId } : {}),
  };
  if (ownerSessionId && leafIds(tab.layout).includes(ownerSessionId)) {
    // Beside its own chat (above that chat's terminal card), never in a
    // pane another chat owns.
    tab = isolateTerminalPanes(tab);
    const pane = newEditorPane(browser);
    const terminal = sessionToolPanes(tab, ownerSessionId, "terminal")[0];
    return {
      ...tab,
      layout: terminal
        ? splitPaneRelative(tab.layout, terminal.id, "down", pane.id, true)
        : splitPaneRelative(tab.layout, ownerSessionId, "right", pane.id, false),
      focusedId: pane.id,
      diffFocused: false,
      editorPanes: [...tab.editorPanes, pane],
    };
  }
  const documents = tab.editorPanes.find((pane) => pane.files.length > 0 &&
    pane.files.every((file) => file.cwd === cwd && isFilesystemTab(file) && !isReviewTab(file)));
  if (documents) return {
    ...tab, focusedId: documents.id, diffFocused: false,
    editorPanes: tab.editorPanes.map((pane) => pane === documents ? { ...pane, files: [browser, ...pane.files] } : pane),
  };
  return openEditorTab(tab, browser);
}

/** Focus this working copy's Changes tab, creating it if needed. */
export function openChangesTab(
  tab: WorkspaceTab,
  cwd: string,
  focusPath?: string,
  focusKind?: GitFileDiffKind,
  projectCwd?: string,
): WorkspaceTab {
  tab = isolateTerminalPanes(tab);
  const next = newChangesTab(cwd, focusPath, focusKind, projectCwd);
  const matches = (file: FilePaneTab) =>
    editorTabKey(file) === editorTabKey(next);
  const existingPane = tab.editorPanes.find((pane) => pane.files.some(matches));
  const existingFile = existingPane?.files.find(matches);

  if (existingPane && existingFile) {
    // Opening the working tree's changes leaves any session's snapshots behind.
    const {
      changeKind: _previousKind,
      sessionChanges: _previousSession,
      ...rest
    } = existingFile;
    const updated = {
      ...rest,
      ...(focusPath ? { path: focusPath } : {}),
      ...(focusKind ? { changeKind: focusKind } : {}),
    };
    return {
      ...tab,
      focusedId: existingPane.id,
      diffFocused: false,
      editorPanes: tab.editorPanes.map((pane) =>
        pane.id === existingPane.id
          ? {
              ...pane,
              files: dropPerFileReviewTabs(pane.files, cwd).map((file) =>
                file.id === updated.id ? updated : file,
              ),
              activeFileId: updated.id,
            }
          : pane,
      ),
    };
  }

  const opened = openEditorTab(tab, next);
  return {
    ...opened,
    editorPanes: opened.editorPanes.map((pane) =>
      pane.files.some(matches)
        ? {
            ...pane,
            files: dropPerFileReviewTabs(pane.files, cwd),
            activeFileId: pane.files.find(matches)?.id ?? pane.activeFileId,
          }
        : pane,
    ),
  };
}

/**
 * Open the working copy's review on one session's captured snapshots. It is
 * the same tab as the working tree's Changes; the session is its source.
 */
export function openSessionChangesTab(
  tab: WorkspaceTab,
  cwd: string,
  sessionId: string,
  focusPath?: string,
  projectCwd?: string,
  pin = false,
  turnId?: string,
): WorkspaceTab {
  tab = isolateTerminalPanes(tab);
  const next = newSessionChangesTab(cwd, sessionId, focusPath, projectCwd, turnId);
  const key = editorTabKey(next);
  const matches = (file: FilePaneTab) => editorTabKey(file) === key;
  const existingPane = tab.editorPanes.find((pane) => pane.files.some(matches));
  const existingFile = existingPane?.files.find(matches);
  if (!existingPane || !existingFile) {
    const opened = openEditorTab(tab, next, { pin });
    return {
      ...opened,
      editorPanes: opened.editorPanes.map((pane) =>
        pane.files.some(matches)
          ? { ...pane, files: dropPerFileReviewTabs(pane.files, cwd) }
          : pane,
      ),
    };
  }

  const { changeKind: _previousKind, ...rest } = existingFile;
  const focused = {
    ...rest,
    sessionChanges: next.sessionChanges,
    ...(focusPath ? { path: focusPath } : {}),
  };
  const updated = pin ? withoutPreview(focused) : focused;
  return {
    ...tab,
    focusedId: existingPane.id,
    diffFocused: false,
    editorPanes: tab.editorPanes.map((pane) =>
      pane.id === existingPane.id
        ? {
            ...pane,
            files: dropPerFileReviewTabs(pane.files, cwd).map((file) =>
              file.id === updated.id ? updated : file,
            ),
            activeFileId: updated.id,
          }
        : pane,
    ),
  };
}

/** Focus a historical commit's unified diff, creating the tab if needed. */
export function openCommitTab(
  tab: WorkspaceTab,
  cwd: string,
  commit: CommitTabSource,
  projectCwd?: string,
  pin = false,
): WorkspaceTab {
  return openEditorTab(tab, newCommitTab(cwd, commit, projectCwd), { pin });
}

function dropPerFileReviewTabs(
  files: FilePaneTab[],
  cwd: string,
): FilePaneTab[] {
  return files.filter(
    (file) =>
      file.cwd !== cwd ||
      !isReviewTab(file) ||
      isChangesTab(file) ||
      isSessionChangesTab(file),
  );
}

/** Open a terminal in its own pane. Files never share this tab strip. */
export function openTerminalTab(
  tab: WorkspaceTab,
  file: FilePaneTab,
  occupyPaneId?: string,
): WorkspaceTab {
  tab = isolateTerminalPanes(tab);
  const occupying =
    occupyPaneId &&
    !tab.editorPanes.some((pane) => pane.id === occupyPaneId) &&
    !tab.terminalPanes.some((pane) => pane.id === occupyPaneId);
  if (occupying && occupyPaneId) {
    const pane = newEditorPane(file);
    return {
      ...tab,
      layout: replaceLeafId(tab.layout, occupyPaneId, pane.id),
      focusedId: pane.id,
      diffFocused: false,
      terminalPanes: [...tab.terminalPanes, pane],
    };
  }

  const focusedPane = tab.terminalPanes.find(
    (pane) => pane.id === tab.focusedId,
  );
  const targetPane = focusedPane ?? tab.terminalPanes[0];
  if (targetPane) {
    return {
      ...tab,
      focusedId: targetPane.id,
      diffFocused: false,
      terminalPanes: tab.terminalPanes.map((pane) =>
        pane.id === targetPane.id
          ? {
              ...pane,
              files: [...pane.files, file],
              activeFileId: file.id,
            }
          : pane,
      ),
    };
  }

  const pane = newEditorPane(file);
  // Terminals stack under the last document card, or open a card column
  // beside chat.
  const ids = leafIds(tab.layout);
  const cards = tab.editorPanes.filter((entry) => ids.includes(entry.id));
  const lastCard = cards[cards.length - 1];
  return {
    ...tab,
    layout: lastCard
      ? splitPane(tab.layout, lastCard.id, "down", pane.id)
      : splitPane(tab.layout, tab.focusedId, "right", pane.id),
    focusedId: pane.id,
    diffFocused: false,
    terminalPanes: [pane],
  };
}

function equalSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return equalSizes(sizes.length);
  return sizes.map((n) => n / total);
}

export function splitPane(
  node: LayoutNode,
  focusedId: string,
  dir: SplitDir,
  newSessionId: string,
): LayoutNode {
  return splitPaneRelative(node, focusedId, dir, newSessionId, false);
}

function splitPaneRelative(
  node: LayoutNode,
  focusedId: string,
  dir: SplitDir,
  newSessionId: string,
  before: boolean,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.id !== focusedId) return node;
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir,
      children: before
        ? [leaf(newSessionId), node]
        : [node, leaf(newSessionId)],
      sizes: [0.5, 0.5],
    };
  }

  const direct = node.children.findIndex(
    (child) => child.type === "leaf" && child.id === focusedId,
  );

  if (direct >= 0) {
    if (node.dir === dir) {
      const insertAt = before ? direct : direct + 1;
      const children = [
        ...node.children.slice(0, insertAt),
        leaf(newSessionId),
        ...node.children.slice(insertAt),
      ];
      return { ...node, children, sizes: equalSizes(children.length) };
    }
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === direct
          ? {
              type: "split",
              id: crypto.randomUUID(),
              dir,
              children: before
                ? [leaf(newSessionId), child]
                : [child, leaf(newSessionId)],
              sizes: [0.5, 0.5],
            }
          : child,
      ),
    };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      splitPaneRelative(child, focusedId, dir, newSessionId, before),
    ),
  };
}

/** Swap one leaf id for another, keeping the split tree intact. */
export function replaceLeafId(
  node: LayoutNode,
  fromId: string,
  toId: string,
): LayoutNode {
  if (fromId === toId) return node;
  if (node.type === "leaf") {
    return node.id === fromId ? leaf(toId) : node;
  }
  return {
    ...node,
    children: node.children.map((child) => replaceLeafId(child, fromId, toId)),
  };
}

/** Drop a leaf. Parent splits collapse to the remaining child. */
export function removePane(
  node: LayoutNode,
  sessionId: string,
): LayoutNode | null {
  if (node.type === "leaf") return node.id === sessionId ? null : node;

  // The closed pane's space goes to its neighbour (the one that takes focus),
  // so the other panes keep their size and do not reflow their content.
  const kept: { child: LayoutNode; size: number }[] = [];
  let freed = 0;
  for (let i = 0; i < node.children.length; i++) {
    const child = removePane(node.children[i], sessionId);
    const size = node.sizes[i] ?? 0;
    if (!child) {
      const previous = kept.at(-1);
      if (previous) previous.size += size;
      else freed += size;
      continue;
    }
    kept.push({ child, size: size + freed });
    freed = 0;
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].child;
  return {
    ...node,
    children: kept.map((item) => item.child),
    sizes: normalize(kept.map((item) => item.size)),
  };
}

/**
 * Close one pane in a tab. Remaining chats, files, and terminals stay;
 * returns null only when this was the last leaf.
 */
export function closeLeaf(
  tab: WorkspaceTab,
  leafId: string,
): WorkspaceTab | null {
  const nextLayout = removePane(tab.layout, leafId);
  if (!nextLayout) return null;
  const nextFocus =
    tab.focusedId === leafId
      ? (siblingLeafId(tab.layout, leafId) ?? firstLeafId(nextLayout))
      : tab.focusedId;
  return { ...tab, layout: nextLayout, focusedId: nextFocus };
}

/** Close every pane of one surface kind. Returns null only when nothing remains. */
export function closeSurfacePanes(
  tab: WorkspaceTab,
  kind: SurfaceKind,
): WorkspaceTab | null {
  const remaining = surfacePanes(tab, kind).reduce<WorkspaceTab | null>(
    (acc, pane) => acc && closeLeaf(acc, pane.id),
    tab,
  );
  return remaining && withSurfacePanes(remaining, kind, []);
}

/** Move the sash between `index` and `index + 1` to `boundary` (0–1 of the group). */
export function setSplitRatio(
  node: LayoutNode,
  splitId: string,
  index: number,
  boundary: number,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (node.id !== splitId) {
    return {
      ...node,
      children: node.children.map((child) =>
        setSplitRatio(child, splitId, index, boundary),
      ),
    };
  }
  if (index < 0 || index >= node.sizes.length - 1) return node;

  return { ...node, sizes: splitSizesAtBoundary(node.sizes, index, boundary) };
}

export function splitSizesAtBoundary(
  current: number[],
  index: number,
  boundary: number,
): number[] {
  if (index < 0 || index >= current.length - 1) return current;
  const sizes = [...current];
  const before = sizes.slice(0, index).reduce((sum, n) => sum + n, 0);
  const pair = sizes[index] + sizes[index + 1];
  const min = Math.min(MIN_SIZE, pair / 2);
  const first = Math.min(pair - min, Math.max(min, boundary - before));
  sizes[index] = first;
  sizes[index + 1] = pair - first;
  return sizes;
}

export function leafIds(node: LayoutNode): string[] {
  if (node.type === "leaf") return [node.id];
  return node.children.flatMap(leafIds);
}

export function firstLeafId(node: LayoutNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.children[0]);
}

export type LayoutRect = { x: number; y: number; w: number; h: number };

export type LayoutLeaf = {
  id: string;
  rect: LayoutRect;
  axis: "x" | "y";
};

export type LayoutSash = {
  splitId: string;
  index: number;
  dir: SplitDir;
  group: LayoutRect;
  sizes: number[];
};

export function layoutLeaves(
  node: LayoutNode,
  rect: LayoutRect = { x: 0, y: 0, w: 1, h: 1 },
  parentDir?: SplitDir,
): LayoutLeaf[] {
  const axis = parentDir === "down" ? "y" : "x";
  if (node.type === "leaf") return [{ id: node.id, rect, axis }];
  const row = node.dir === "right";
  let offset = 0;
  const out: LayoutLeaf[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const size = node.sizes[i] ?? 0;
    const child: LayoutRect = row
      ? { x: rect.x + offset * rect.w, y: rect.y, w: size * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: size * rect.h };
    offset += size;
    out.push(...layoutLeaves(node.children[i], child, node.dir));
  }
  return out;
}

export function layoutSashes(
  node: LayoutNode,
  rect: LayoutRect = { x: 0, y: 0, w: 1, h: 1 },
): LayoutSash[] {
  if (node.type === "leaf") return [];
  const row = node.dir === "right";
  let offset = 0;
  const out: LayoutSash[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const size = node.sizes[i] ?? 0;
    if (i > 0) {
      out.push({
        splitId: node.id,
        index: i - 1,
        dir: node.dir,
        group: rect,
        sizes: node.sizes,
      });
    }
    const child: LayoutRect = row
      ? { x: rect.x + offset * rect.w, y: rect.y, w: size * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: size * rect.h };
    offset += size;
    out.push(...layoutSashes(node.children[i], child));
  }
  return out;
}

function leafRects(node: LayoutNode): LayoutLeaf[] {
  return layoutLeaves(node);
}

function rangeOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Adjacent leaf in `dir`, preferring panes that share an edge. */
export function neighborLeafId(
  node: LayoutNode,
  focusedId: string,
  dir: FocusDir,
): string | null {
  const panes = leafRects(node);
  const current = panes.find((p) => p.id === focusedId);
  if (!current) return null;
  const c = current.rect;

  let best: { id: string; hit: number; gap: number; overlap: number } | null =
    null;
  for (const pane of panes) {
    if (pane.id === focusedId) continue;
    const r = pane.rect;
    let gap = Infinity;
    let perp = 0;
    if (dir === "left" && r.x + r.w <= c.x + 1e-6) {
      gap = c.x - (r.x + r.w);
      perp = rangeOverlap(c.y, c.y + c.h, r.y, r.y + r.h);
    } else if (dir === "right" && r.x >= c.x + c.w - 1e-6) {
      gap = r.x - (c.x + c.w);
      perp = rangeOverlap(c.y, c.y + c.h, r.y, r.y + r.h);
    } else if (dir === "up" && r.y + r.h <= c.y + 1e-6) {
      gap = c.y - (r.y + r.h);
      perp = rangeOverlap(c.x, c.x + c.w, r.x, r.x + r.w);
    } else if (dir === "down" && r.y >= c.y + c.h - 1e-6) {
      gap = r.y - (c.y + c.h);
      perp = rangeOverlap(c.x, c.x + c.w, r.x, r.x + r.w);
    } else {
      continue;
    }
    const hit = perp > 0 ? 0 : 1;
    if (
      !best ||
      hit < best.hit ||
      (hit === best.hit && gap < best.gap) ||
      (hit === best.hit && gap === best.gap && perp > best.overlap)
    ) {
      best = { id: pane.id, hit, gap, overlap: perp };
    }
  }
  return best?.id ?? null;
}

/** Session to focus after closing `sessionId` — a neighbor's first leaf. */
export function siblingLeafId(
  node: LayoutNode,
  sessionId: string,
): string | null {
  if (node.type === "leaf") return null;
  const index = node.children.findIndex(
    (child) => child.type === "leaf" && child.id === sessionId,
  );
  if (index >= 0) {
    const neighbor = node.children[index - 1] ?? node.children[index + 1];
    return neighbor ? firstLeafId(neighbor) : null;
  }
  for (const child of node.children) {
    const found = siblingLeafId(child, sessionId);
    if (found) return found;
  }
  return null;
}

export type PanePlace = "before" | "after";
export type PaneEdge = "left" | "right" | "top" | "bottom";

type SplitNode = Extract<LayoutNode, { type: "split" }>;

export function paneEdgeFromPoint(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
): PaneEdge {
  const nx = rect.width <= 0 ? 0 : (x - rect.left) / rect.width - 0.5;
  const ny = rect.height <= 0 ? 0 : (y - rect.top) / rect.height - 0.5;
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? "left" : "right";
  return ny < 0 ? "top" : "bottom";
}

function edgeSplit(edge: PaneEdge): { dir: SplitDir; place: PanePlace } {
  if (edge === "left") return { dir: "right", place: "before" };
  if (edge === "right") return { dir: "right", place: "after" };
  if (edge === "top") return { dir: "down", place: "before" };
  return { dir: "down", place: "after" };
}

function leafParent(
  node: LayoutNode,
  leafId: string,
): { parentId: string; index: number; dir: SplitDir } | null {
  if (node.type === "leaf") return null;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === "leaf" && child.id === leafId) {
      return { parentId: node.id, index: i, dir: node.dir };
    }
    const found = leafParent(child, leafId);
    if (found) return found;
  }
  return null;
}

function reorderChild(
  split: SplitNode,
  fromIndex: number,
  toIndex: number,
  place: PanePlace,
): SplitNode {
  const n = split.children.length;
  if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) {
    return split;
  }
  let insertAt = place === "after" ? toIndex + 1 : toIndex;
  insertAt = Math.max(0, Math.min(n, insertAt));
  if (fromIndex < insertAt) insertAt -= 1;
  if (fromIndex === insertAt) return split;
  const children = [...split.children];
  const sizes = [...split.sizes];
  const [child] = children.splice(fromIndex, 1);
  const [size] = sizes.splice(fromIndex, 1);
  children.splice(insertAt, 0, child);
  sizes.splice(insertAt, 0, size);
  return { ...split, children, sizes };
}

function reorderInSplit(
  node: LayoutNode,
  splitId: string,
  fromIndex: number,
  toIndex: number,
  place: PanePlace,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return reorderChild(node, fromIndex, toIndex, place);
  return {
    ...node,
    children: node.children.map((child) =>
      reorderInSplit(child, splitId, fromIndex, toIndex, place),
    ),
  };
}

function extractLeaf(
  node: LayoutNode,
  leafId: string,
): {
  tree: LayoutNode | null;
  leaf: Extract<LayoutNode, { type: "leaf" }>;
} | null {
  if (node.type === "leaf") {
    return node.id === leafId ? { tree: null, leaf: node } : null;
  }

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  let leaf: Extract<LayoutNode, { type: "leaf" }> | null = null;

  for (let i = 0; i < node.children.length; i++) {
    const extracted = extractLeaf(node.children[i], leafId);
    if (!extracted) {
      children.push(node.children[i]);
      sizes.push(node.sizes[i] ?? 0);
      continue;
    }
    leaf = extracted.leaf;
    if (extracted.tree) {
      children.push(extracted.tree);
      sizes.push(node.sizes[i] ?? 0);
    }
  }

  if (!leaf) return null;
  if (children.length === 0) return { tree: null, leaf };
  if (children.length === 1) return { tree: children[0], leaf };
  return {
    tree: { ...node, children, sizes: normalize(sizes) },
    leaf,
  };
}

function insertBeside(
  node: LayoutNode,
  targetId: string,
  incoming: LayoutNode,
  place: PanePlace,
): LayoutNode {
  if (node.type === "leaf") return node;

  const index = node.children.findIndex(
    (child) => child.type === "leaf" && child.id === targetId,
  );
  if (index >= 0) {
    const insertAt = place === "before" ? index : index + 1;
    const children = [...node.children];
    const sizes = [...node.sizes];
    const share = (sizes[index] ?? 0) / 2;
    sizes[index] = share;
    children.splice(insertAt, 0, incoming);
    sizes.splice(insertAt, 0, share);
    return { ...node, children, sizes };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      insertBeside(child, targetId, incoming, place),
    ),
  };
}

function wrapBeside(
  node: LayoutNode,
  targetId: string,
  incoming: LayoutNode,
  dir: SplitDir,
  place: PanePlace,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir,
      children: place === "before" ? [incoming, node] : [node, incoming],
      sizes: [0.5, 0.5],
    };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      wrapBeside(child, targetId, incoming, dir, place),
    ),
  };
}

/**
 * Drag a leaf onto another pane's edge. Same-axis siblings keep their
 * sizes and only swap order; a perpendicular edge nests a new split
 * around the target; dropping onto a pane in another group of the
 * same axis relocates the leaf there.
 */
export function movePane(
  node: LayoutNode,
  fromId: string,
  toId: string,
  edge: PaneEdge,
): LayoutNode {
  if (fromId === toId) return node;
  const fromAt = leafParent(node, fromId);
  const toAt = leafParent(node, toId);
  if (!fromAt || !toAt) return node;

  const { dir, place } = edgeSplit(edge);
  if (toAt.dir === dir && fromAt.parentId === toAt.parentId) {
    return reorderInSplit(
      node,
      fromAt.parentId,
      fromAt.index,
      toAt.index,
      place,
    );
  }

  const extracted = extractLeaf(node, fromId);
  if (!extracted?.tree) return node;
  if (!leafIds(extracted.tree).includes(toId)) return node;
  const targetAt = leafParent(extracted.tree, toId);
  if (targetAt?.dir === dir) {
    return insertBeside(extracted.tree, toId, extracted.leaf, place);
  }
  return wrapBeside(extracted.tree, toId, extracted.leaf, dir, place);
}

/** A manual drop owns placement; subsequent fitting may only adjust sizes. */
export function moveTabPane(
  tab: WorkspaceTab,
  fromId: string,
  toId: string,
  edge: PaneEdge,
): WorkspaceTab {
  const ids = leafIds(tab.layout);
  if (fromId === toId || !ids.includes(fromId) || !ids.includes(toId)) return tab;
  const layout = movePane(tab.layout, fromId, toId, edge);
  return layout === tab.layout && tab.autoArrangeTools === false && tab.focusedId === fromId ? tab : {
    ...tab,
    layout,
    focusedId: fromId,
    autoArrangeTools: false,
  };
}

/**
 * Open `sessionId` on `toId`'s edge, or move it there when it is
 * already a leaf in this tree.
 */
export function placePane(
  node: LayoutNode,
  sessionId: string,
  toId: string,
  edge: PaneEdge,
): LayoutNode {
  if (sessionId === toId) return node;
  const ids = leafIds(node);
  if (!ids.includes(toId)) return node;
  if (ids.includes(sessionId)) return movePane(node, sessionId, toId, edge);

  return placeLayout(node, leaf(sessionId), toId, edge);
}

/** Place an intact layout tree beside one pane in another layout. */
export function placeLayout(
  node: LayoutNode,
  incoming: LayoutNode,
  toId: string,
  edge: PaneEdge,
): LayoutNode {
  if (!leafIds(node).includes(toId)) return node;

  const { dir, place } = edgeSplit(edge);
  const targetAt = leafParent(node, toId);
  if (targetAt?.dir === dir) {
    return insertBeside(node, toId, incoming, place);
  }
  return wrapBeside(node, toId, incoming, dir, place);
}
