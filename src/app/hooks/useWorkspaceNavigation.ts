import { useCallback, useEffect, useRef, useState } from "react";
import {
  isBlankSession,
  reconcileProjectReturn,
  type ProjectReturnMemory,
} from "../../features/projects/model/projectReturn";
import {
  isRemoteProjectPath,
  sameProjectPath,
} from "../../features/projects/model/recents";
import type { Session } from "../../features/sessions/model/session";
import {
  setWorktreeFocus,
  worktreeFocus,
  type WorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import type { Worktree } from "../../features/source-control/model/worktrees";
import {
  isAppViewOnlyTab,
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import {
  filterTabsForProject,
  workspaceTabCwd,
  workspaceTabWorktree,
} from "../../features/workspace/model/workspaceTabGroups";
import { isEqualOrInside, pathKey } from "../../shared/lib/paths";

type Destination = { project: string; focus?: WorktreeFocus };
type Request = Destination & { kind: "project" | "workspace" };
type Snapshot = {
  project: string;
  activeTabId: string;
  tabs: WorkspaceTab[];
  sessions: Session[];
};
type Options = Snapshot & {
  getSnapshot?: () => Snapshot;
  restoredProjectReturn?: ProjectReturnMemory;
  restoreDefaultWorkspaces?: boolean;
  moveSession: (
    id: string,
    tree: Worktree,
    isCurrent: () => boolean,
  ) => Promise<void>;
  activateTab: (id: string, paneId?: string) => void;
  setActiveTabId: (id: string) => void;
  createTab: (project: string, focus?: WorktreeFocus) => string;
  canReuseBlank?: (sessionId: string) => boolean;
};

const workspaceKey = (project: string, path: string) =>
  `${pathKey(project)}\0${pathKey(path)}`;

/** Workspace requests own their async completion. Ordinary tab/session opens
 * cancel them and never invoke the remembered-tab selection path. */
export function useWorkspaceNavigation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const request = useRef<Request | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const moving = useRef(new Set<string>());
  const moves = useRef(new Map<string, { path: string }>());
  const memory = useRef(new Map<string, string>());
  const projectReturn = useRef(options.restoredProjectReturn ?? new Map());
  // Only default-workspace tabs are persisted. Their checkout can still be
  // another worktree, so restoring must preserve the saved workspace ownership.
  const [pins] = useState(
    () =>
      new Map<string, string>(
        options.restoreDefaultWorkspaces
          ? options.tabs.flatMap((tab) => {
              const project = workspaceTabCwd(tab, options.sessions);
              return project && !isRemoteProjectPath(project)
                ? [[tab.id, project] as const]
                : [];
            })
          : [],
      ),
  );
  const [revision, refreshPins] = useState(0);
  const [pending, setPending] = useState<Request | null>(null);
  const [error, setError] = useState<{
    project: string;
    message: string;
  } | null>(null);

  const snapshot = useCallback(
    () => latest.current.getSnapshot?.() ?? latest.current,
    [],
  );
  const tabWorkspace = useCallback(
    (tab: WorkspaceTab, sessions: readonly Session[] = snapshot().sessions) => {
      if (isAppViewOnlyTab(tab)) return null;
      const pinned = pins.get(tab.id);
      if (pinned) return pinned;
      for (const id of leafIds(tab.layout)) {
        const path = pins.get(id);
        if (path) return path;
      }
      return workspaceTabWorktree(tab, sessions);
    },
    [pins, snapshot],
  );
  const keepWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      const view = snapshot();
      const project = workspaceTabCwd(tab, view.sessions);
      if (!project || isRemoteProjectPath(project)) return true;
      const workspace = tabWorkspace(tab, view.sessions);
      return !workspace || sameProjectPath(workspace, project);
    },
    [snapshot, tabWorkspace],
  );
  const readProjectReturnMemory = useCallback(
    (view = snapshot()) => {
      projectReturn.current = reconcileProjectReturn({
        memory: projectReturn.current,
        ...view,
      });
      return projectReturn.current;
    },
    [snapshot],
  );
  const pin = useCallback(
    (id: string, path: string) => {
      if (pins.get(id) === path) return;
      pins.set(id, path);
      refreshPins((value) => value + 1);
    },
    [pins],
  );
  const pinSessionToCurrentWorkspace = useCallback(
    (id: string, project: string) => {
      pin(id, worktreeFocus(project)?.path ?? project);
    },
    [pin],
  );
  const unpinSession = useCallback(
    (id: string) => {
      if (pins.delete(id)) refreshPins((value) => value + 1);
    },
    [pins],
  );
  const forgetSessions = useCallback(
    (ids: ReadonlySet<string>) => {
      let changed = false;
      for (const id of ids) changed = pins.delete(id) || changed;
      for (const tab of snapshot().tabs) {
        if (leafIds(tab.layout).every((id) => ids.has(id)))
          changed = pins.delete(tab.id) || changed;
      }
      projectReturn.current = new Map(
        [...projectReturn.current].filter(([, id]) => !ids.has(id)),
      );
      if (changed) refreshPins((value) => value + 1);
    },
    [pins, snapshot],
  );

  // Cancellation invalidates navigation, but the underlying checkout move
  // remains locked until its asynchronous cleanup has completed.
  const isMoving = useCallback((id: string) => moves.current.has(id), []);
  const hasMoveInto = useCallback(
    (path: string) =>
      [...moves.current.values()].some((move) =>
        isEqualOrInside(move.path, path),
      ),
    [],
  );
  const beginMove = useCallback((id: string, path: string) => {
    if (moves.current.has(id)) return null;
    const move = { path };
    moves.current.set(id, move);
    return () => {
      if (moves.current.get(id) === move) moves.current.delete(id);
    };
  }, []);

  const cancel = useCallback(() => {
    request.current = null;
    setPending(null);
    setError(null);
  }, []);
  const setActiveTabId = useCallback(
    (id: string) => {
      cancel();
      latest.current.setActiveTabId(id);
    },
    [cancel],
  );
  const activateTab = useCallback(
    (id: string, paneId?: string) => {
      cancel();
      latest.current.activateTab(id, paneId);
    },
    [cancel],
  );

  const select = useCallback((next: Request) => {
    if (
      !next.project ||
      next.project === "~" ||
      isRemoteProjectPath(next.project)
    )
      return;
    request.current = next;
    setError(null);
    setPending(next);
  }, []);
  const selectWorkspace = useCallback(
    (project: string, focus?: WorktreeFocus) => {
      select({ kind: "workspace", project, focus });
    },
    [select],
  );
  const selectProject = useCallback(
    (project: string) => {
      select({ kind: "project", project, focus: worktreeFocus(project) });
    },
    [select],
  );

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (mounted.current && request.current) {
        const next = request.current;
        const view = latest.current;
        // A project request is recorded in the same event as openProjects.
        // Wait for its landing tab to render before choosing its workspace.
        if (!sameProjectPath(view.project, next.project)) break;
        const tab = view.tabs.find((entry) => entry.id === view.activeTabId);
        if (!tab) break;
        const session = view.sessions.find(
          (entry) => entry.id === tab.focusedId,
        );
        const path = next.focus?.path ?? next.project;
        const key = workspaceKey(next.project, path);
        const isCurrent = () =>
          mounted.current &&
          request.current === next &&
          latest.current.activeTabId === tab.id &&
          latest.current.tabs.find((entry) => entry.id === tab.id)
            ?.focusedId === tab.focusedId &&
          sameProjectPath(latest.current.project, next.project);
        try {
          // Mixed-project split tabs keep their existing grouping when the
          // focused pane's project changes. Consume the request without
          // moving the tab or leaving an unfinished navigation behind.
          if (
            !sameProjectPath(
              workspaceTabCwd(tab, view.sessions) ?? "",
              next.project,
            )
          ) {
            setWorktreeFocus(next.project, next.focus);
            continue;
          }
          const scoped = filterTabsForProject(
            view.tabs,
            view.sessions,
            next.project,
          ).filter((entry) => {
            if (isAppViewOnlyTab(entry)) return false;
            const workspace = tabWorkspace(entry, view.sessions);
            return !workspace || sameProjectPath(workspace, path);
          });
          const workspace = tabWorkspace(tab, view.sessions);
          const target =
            !workspace || sameProjectPath(workspace, path)
              ? tab
              : (scoped.find((entry) => entry.id === memory.current.get(key)) ??
                scoped[scoped.length - 1]);
          let tabId: string;
          if (target) {
            tabId = target.id;
          } else if (
            session &&
            isBlankSession(session) &&
            (view.canReuseBlank?.(session.id) ?? true) &&
            sameProjectPath(session.cwd, next.project)
          ) {
            moving.current.add(session.id);
            await view.moveSession(
              session.id,
              {
                path,
                branch: next.focus?.branch ?? null,
                head: "",
                isMain: !next.focus,
                locked: false,
                prunable: false,
                missing: false,
                dirty: null,
                unpushed: null,
                sessionIds: [],
              },
              isCurrent,
            );
            if (!isCurrent()) continue;
            tabId = tab.id;
          } else if (next.kind === "project") {
            // Returning through the project rail keeps its landing
            // conversation when the remembered workspace has no open tab.
            // Its checkout stays attached to that conversation.
            tabId = tab.id;
          } else {
            tabId = view.createTab(next.project, next.focus);
          }
          if (!isCurrent()) continue;
          // Only a successful, current request publishes the workspace. A
          // superseded move never changes focus or pins an unrelated tab.
          pin(tabId, path);
          memory.current.set(key, tabId);
          setWorktreeFocus(next.project, next.focus);
          view.activateTab(tabId);
        } catch (caught) {
          if (isCurrent()) {
            // A project rail landing may still be in its default workspace.
            // If restoring the remembered workspace fails, keep that landing
            // usable and label the workspace it actually belongs to.
            if (next.kind === "project") {
              const landing = tabWorkspace(tab, view.sessions) ?? next.project;
              setWorktreeFocus(
                next.project,
                sameProjectPath(landing, next.project)
                  ? undefined
                  : { path: landing, branch: session?.branch ?? null },
              );
            }
            setError({
              project: next.project,
              message:
                caught instanceof Error ? caught.message : String(caught),
            });
          }
        } finally {
          if (request.current === next) {
            request.current = null;
            setPending(null);
          }
        }
      }
    } finally {
      moving.current.clear();
      running.current = false;
    }
  }, [pin, tabWorkspace]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current = null;
    };
  }, []);

  // A session opened directly joins the workspace on screen without changing
  // the session's checkout. No navigation reason survives for a future open.
  const focusedId = options.tabs.find(
    (tab) => tab.id === options.activeTabId,
  )?.focusedId;
  useEffect(() => {
    if (request.current) return;
    const view = latest.current;
    const tab = view.tabs.find((entry) => entry.id === view.activeTabId);
    if (!tab) return;
    const project = workspaceTabCwd(tab, view.sessions);
    if (!project || project === "~" || isRemoteProjectPath(project)) return;
    const path = worktreeFocus(project)?.path ?? project;
    pin(tab.id, path);
    memory.current.set(workspaceKey(project, path), tab.id);
  }, [options.project, options.activeTabId, focusedId, pin]);

  useEffect(() => {
    readProjectReturnMemory();
  }, [
    options.activeTabId,
    options.tabs,
    options.sessions,
    readProjectReturnMemory,
  ]);

  useEffect(() => {
    void drain();
  }, [
    pending,
    options.project,
    options.activeTabId,
    options.tabs,
    options.sessions,
    drain,
  ]);

  const isSwitching = useCallback((sessionId: string) => {
    if (moving.current.has(sessionId) || moves.current.has(sessionId))
      return true;
    const next = request.current;
    const view = latest.current;
    return (
      !!next &&
      view.tabs.some(
        (tab) =>
          tab.id === view.activeTabId &&
          tab.focusedId === sessionId &&
          sameProjectPath(
            workspaceTabCwd(tab, view.sessions) ?? "",
            next.project,
          ),
      )
    );
  }, []);

  return {
    activateTab,
    setActiveTabId,
    tabWorkspace,
    keepWorkspaceTab,
    readProjectReturnMemory,
    pinSessionToCurrentWorkspace,
    unpinSession,
    forgetSessions,
    isMoving,
    hasMoveInto,
    beginMove,
    selectWorkspace,
    selectProject,
    cancel,
    isSwitching,
    pending,
    error,
    revision,
  };
}

export type WorkspaceNavigation = ReturnType<typeof useWorkspaceNavigation>;
