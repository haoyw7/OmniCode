import { reportQuitState, confirmQuitDecision, reportQuitReady, hideWorkspaceWindow, destroyWorkspaceWindow } from "../../platform/tauri/appShell";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";
import { confirmNativeAction } from "../../platform/tauri/dialogs";
import { hasInFlightSessions, inFlightRefs, isInFlightSession, quitWhileBusyMessage, workspaceFromResumed, type ResumedWorkspace } from "../../features/sessions/model/inFlight";
import { leafIds, type WorkspaceTab } from "../../features/workspace/model/layout";
import { killPty } from "../../platform/tauri/pty";
import { projectTerminalFileIds, type DockSide, type ProjectTerminalDock } from "../../features/projects/model/projectTerminal";
import { type Session } from "../../contracts/session";
import { getSession, listInFlightSessions, listSessionsByProject, loadWorkspaceSnapshot, saveWorkspaceSnapshot, type SessionSummary } from "../../features/sessions/data/sessionStore";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot, parseWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
import { loadWindowTransfer } from "./windowTransferBootstrap";
import type { WindowTransferPayload } from "./windowTransfer";
import { lastProjectPath, sameProjectPath } from "../../features/projects/model/recents";
import { normalizeProjectPath } from "../../domain/pathDisplay";
import type { ProjectReturnMemory } from "../../features/projects/model/projectReturn";

export type { ResumedWorkspace };
export { hasInFlightSessions };

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
  /** Sidebar rows listed before first paint, so the rail is not empty. */
  history: SessionSummary[];
  historyCwd: string | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let quitDialogOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  projectReturnMemory: () => ProjectReturnMemory;
  lastDockSide: () => DockSide | null;
  keepTab?: (tab: WorkspaceTab) => boolean;
} | null = null;

export function isAppQuitting(): boolean {
  return quitting;
}

export function setQuitWorkspace(
  sessions: () => Session[],
  tabs: () => WorkspaceTab[],
  activeTabId: () => string,
  projectCwd: () => string,
  projectTerminals: () => ProjectTerminalDock[],
  projectReturnMemory: () => ProjectReturnMemory,
  lastDockSide: () => DockSide | null = () => null,
  keepTab?: (tab: WorkspaceTab) => boolean,
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    projectReturnMemory,
    lastDockSide,
    keepTab,
  };
  bootingResumed = null;
  return () => {
    if (liveWorkspace?.sessions === sessions) liveWorkspace = null;
  };
}

/**
 * Persist this window for a quit the coordinator has already confirmed.
 * Exiting is `confirm_quit`'s job, once every window has reported ready.
 */
export async function handleQuitRequested(): Promise<boolean> {
  if (liveWorkspace) {
    quitting = true;
    try {
      await persistQuitState(
        liveWorkspace.sessions(),
        liveWorkspace.tabs(),
        liveWorkspace.activeTabId(),
        liveWorkspace.projectCwd(),
        liveWorkspace.projectReturnMemory(),
        "quit",
        liveWorkspace.projectTerminals(),
        liveWorkspace.lastDockSide() ?? undefined,
        liveWorkspace.keepTab,
      );
      return true;
    } catch {
      quitting = false;
      return false;
    }
  }
  const { resumed } = await loadBootWorkspace();
  const pending = resumed ?? bootingResumed;
  quitting = true;
  if (!pending) return true;
  try {
    await persistBootingResume(pending);
    return true;
  } catch {
    quitting = false;
    return false;
  }
}

/** Each window counts its own live turns; Rust sums them into one decision. */
export async function reportQuitPoll(id: number): Promise<void> {
  let inFlight = 0;
  if (liveWorkspace) {
    // Every running turn, not just the resumable ones `inFlightRefs` keeps:
    // an Inbox Ask still counts as work nobody agreed to throw away.
    inFlight = liveWorkspace.sessions().filter(isInFlightSession).length;
  }
  await reportQuitState(id, inFlight).catch(() => undefined);
}

/** The one quit dialog, shown by whichever window the coordinator picked. */
export async function askQuitConfirmation(
  id: number,
  inFlight: number,
): Promise<void> {
  let confirmed = false;
  if (!quitDialogOpen) {
    quitDialogOpen = true;
    try {
      confirmed = await confirmNativeAction(quitWhileBusyMessage(inFlight), {
        title: "OmniCode",
        kind: "warning",
        okLabel: "Quit",
      });
    } catch {
      confirmed = false;
    } finally {
      quitDialogOpen = false;
    }
  }
  await confirmQuitDecision(id, confirmed).catch(() => undefined);
}

export async function commitQuit(id: number): Promise<void> {
  const persisted = await handleQuitRequested();
  await reportQuitReady(id, persisted).catch(() => undefined);
}

/**
 * A quit that stopped part-way because another window could not save. This
 * window is staying open, so it must go back to persisting on unload.
 */
export function abortQuit(): void {
  quitting = false;
}

/** Confirm and stop this window's work without terminating other windows. */
export async function closeBusyWindow(): Promise<void> {
  if (!liveWorkspace) return;
  await confirmAndCloseWindow(
    liveWorkspace.sessions(),
    liveWorkspace.tabs(),
    liveWorkspace.activeTabId(),
    liveWorkspace.projectCwd(),
    liveWorkspace.projectReturnMemory(),
    liveWorkspace.projectTerminals(),
    liveWorkspace.lastDockSide() ?? undefined,
  );
}

export function loadResumedWorkspace(): Promise<ResumedWorkspace | null> {
  if (!resumedPromise) resumedPromise = loadResumedWorkspaceOnce();
  return resumedPromise;
}

/** Transfer and restore run once; callers share the same promise. */
export function loadBootWorkspace(): Promise<BootWorkspace> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const hintedCwd = lastProjectPath();
      const historyHint = listProjectHistory(hintedCwd);
      const windowTransfer = await loadWindowTransfer();
      if (windowTransfer) {
        const listed = await historyForCwd(
          windowTransfer.projectCwd,
          hintedCwd,
          historyHint,
        );
        return {
          windowTransfer,
          resumed: null,
          history: listed?.rows ?? [],
          historyCwd: listed?.cwd ?? null,
        };
      }
      const [resumed, hinted] = await Promise.all([
        loadResumedWorkspace(),
        historyHint,
      ]);
      const listed = await historyForCwd(
        resumed?.projectCwd ?? hintedCwd,
        hintedCwd,
        Promise.resolve(hinted),
      );
      return {
        windowTransfer: null,
        resumed,
        history: listed?.rows ?? [],
        historyCwd: listed?.cwd ?? null,
      };
    })();
  }
  return bootPromise;
}

async function listProjectHistory(
  cwd: string | null | undefined,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  try {
    const rows = await listSessionsByProject(cwd);
    return { cwd: normalizeProjectPath(cwd), rows };
  } catch {
    return null;
  }
}

async function historyForCwd(
  cwd: string | null | undefined,
  hintedCwd: string | null | undefined,
  hinted: Promise<{ cwd: string; rows: SessionSummary[] } | null>,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  if (hintedCwd && sameProjectPath(cwd, hintedCwd)) return hinted;
  return listProjectHistory(cwd);
}

async function loadResumedWorkspaceOnce(): Promise<ResumedWorkspace | null> {
  const [snapshotRaw, refs] = await Promise.all([
    loadWorkspaceSnapshot().catch(() => null),
    listInFlightSessions().catch(() => []),
  ]);
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);

  const ids = new Set<string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) ids.add(stub.id);
    for (const tab of snapshot.tabs) {
      for (const id of leafIds(tab.layout)) ids.add(id);
    }
  }
  for (const ref of refs) ids.add(ref.sessionId);

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      const record = await getSession(id).catch(() => null);
      if (record) loaded.set(id, record);
    }),
  );

  // Legacy IDs only restore navigation. Host projections retain their live
  // execution state; reopening a WebView never interrupts or restarts a turn.
  const interrupted = new Set(refs.map(ref => ref.sessionId));

  let workspace = snapshot
    ? hydrateWorkspaceSnapshot(snapshot, loaded, interrupted)
    : null;
  if (!workspace && refs.length > 0) {
    const sessions: Session[] = [];
    for (const ref of refs) {
      const record = loaded.get(ref.sessionId);
      if (!record) continue;
      sessions.push(record);
    }
    workspace = workspaceFromResumed(sessions);
  }
  if (workspace) {
    workspace.sessions = workspace.sessions.map((session) => {
      const record = loaded.get(session.id);
      return record && sessionUsesHost(record) ? record : session;
    });
  }

  bootingResumed = workspace;
  return workspace;
}

export async function hideCurrentWindow(): Promise<void> {
  await hideWorkspaceWindow();
}

export async function closeCurrentWindow(): Promise<void> {
  await destroyWorkspaceWindow();
}

export async function confirmReload(
  hasUnsavedFiles: boolean,
): Promise<boolean> {
  if (!hasUnsavedFiles) return true;
  return confirmNativeAction("Reload OmniCode and discard unsaved changes?", {
    title: "OmniCode",
    kind: "warning",
    okLabel: "Reload",
  });
}

export async function persistQuitState(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  mode: "quit" | "unload" = "quit",
  projectTerminals: ProjectTerminalDock[] = [],
  lastDockSide?: DockSide,
  keepTab?: (tab: WorkspaceTab) => boolean,
): Promise<void> {
  // Window state contains navigation and blank composers, never session rows.
  const write = <T,>(pending: Promise<T>): Promise<T | null> =>
    mode === "quit" ? pending : pending.catch(() => null);
  await write(
    saveWorkspaceSnapshot(
      collectWorkspaceSnapshot(
        tabs,
        sessions,
        activeTabId,
        projectCwd,
        memory,
        projectTerminals,
        lastDockSide,
        keepTab,
      ),
    ),
  );

}

async function persistBootingResume(workspace: ResumedWorkspace): Promise<void> {
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectReturnMemory ?? new Map(),
      workspace.projectTerminals ?? [],
      workspace.lastDockSide,
    ),
  ).catch(() => undefined);

}

async function confirmAndCloseWindow(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  projectTerminals: ProjectTerminalDock[] = [],
  lastDockSide?: DockSide,
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) {
      const ok = await confirmNativeAction(
        "Close this window? Running chats will continue on Host.",
        { title: "OmniCode", kind: "warning", okLabel: "Close window" },
      );
      if (!ok) return;
    }
    quitting = true;
    try {
      await persistQuitState(
        sessions,
        tabs,
        activeTabId,
        projectCwd,
        memory,
        "quit",
        projectTerminals,
        lastDockSide,
      );
      await reapWindowRuntime(tabs, projectTerminals);
      await closeCurrentWindow();
    } catch {
      quitting = false;
    }
  } finally {
    quitDialogOpen = false;
  }
}

export async function reapWindowRuntime(
  tabs: WorkspaceTab[],
  projectTerminals: ProjectTerminalDock[] = [],
): Promise<void> {
  // Local PTYs remain shell-owned until the Host PTY latency gate is verified.
  await Promise.all(
    [...terminalFileIds(tabs), ...projectTerminalFileIds(projectTerminals)].map(id => killPty(id)),
  );
}

function terminalFileIds(tabs: WorkspaceTab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.terminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
