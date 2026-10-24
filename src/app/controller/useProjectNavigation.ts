import { useCallback, useTransition, type Dispatch, type RefObject, type SetStateAction } from "react";
import { rememberRemotePendingExecutionCwd } from "../../features/connections/model/connections";
import { planProjectOpenRun, type ProjectOpenStep } from "../../features/projects/model/projectOpenRun";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import { looksLikeProject, rememberProject, sameProjectPath, type RecentProject } from "../../features/projects/model/recents";
import { normalizeProjectPath } from "../../domain/pathDisplay";
import { keepSessionChanges, notifyReviewChanged } from "../../features/sessions/model/checkpoint";
import { newSession, retargetSessionToProject } from "../../features/sessions/model/session";
import { type Session } from "../../contracts/session";
import type { WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import { leafIds, newTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { removeTabFromGroup, tabGroupProject } from "../../features/workspace/model/tabGroups";
import { pickFolders } from "../../platform/tauri/fs";
import { projectName } from "../../shared/lib/paths";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";

type Options = {
  navigation: Pick<
    WorkspaceNavigation,
    | "activateTab"
    | "setActiveTabId"
    | "cancel"
    | "selectProject"
    | "selectWorkspace"
    | "readProjectReturnMemory"
  >;
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  sidebarCwdRef: RefObject<string>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  canDiscardEmptySession: (id: string) => boolean;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  insertBeside: (
    tabs: WorkspaceTab[],
    tab: WorkspaceTab,
    anchorId?: string,
    cwd?: string,
  ) => WorkspaceTab[];
  projectOfTab: (id: string) => string | undefined;
};

/** Project selection and folder batches share one return/draft policy. */
export function useProjectNavigation({
  navigation,
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  sidebarCwdRef,
  setSessions,
  setTabs,
  setProjectCwd,
  setRecents,
  setComposerFocused,
  canDiscardEmptySession,
  appendTab,
  insertBeside,
  projectOfTab,
}: Options) {
  const {
    activateTab,
    setActiveTabId,
    cancel,
    selectProject,
    selectWorkspace,
    readProjectReturnMemory,
  } = navigation;
  const onCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      cancel();
      const normalized = normalizeProjectPath(cwd);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const previous = current?.cwd;
      // Started conversations stay bound to their project. An unsent composer
      // changes folders in place, retaining its draft, attachments and reads.
      if (
        current &&
        previous &&
        looksLikeProject(previous) &&
        !sameProjectPath(previous, normalized) &&
        !isBlankSession(current)
      ) {
        setProjectCwd(normalized);
        setRecents(rememberProject(normalized));
        const session = newSession(
          current.harness,
          normalized,
          current.model,
          current.runtimeMode,
          current.modelSettings,
        );
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, normalized);
        setActiveTabId(tab.id);
        setComposerFocused(true);
        return;
      }
      if (previous && !sameProjectPath(previous, normalized)) {
        rememberRemotePendingExecutionCwd(sessionId);
        if (previous !== "~")
          void keepSessionChanges(sessionId, previous).catch(() => undefined);
      }
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // A blank session moving into a project adopts its provider defaults;
          // a conversation keeps its own provider.
          const base = isBlankSession(s)
            ? retargetSessionToProject(s, normalized)
            : s;
          return {
            ...base,
            cwd: normalized,
            branch: undefined,
            executionCwd: undefined,
            linkedWorktree: undefined,
            worktreeRemoved: undefined,
            workspaceMode: undefined,
            worktreeBase: undefined,
          };
        }),
      );
      // The session's project just moved in place; a group only holds tabs that
      // share one project, so drop this tab out if it no longer matches.
      setTabs((prev) => {
        const tab = prev.find((t) => leafIds(t.layout).includes(sessionId));
        // The tab's visible project follows its focused pane; a background
        // pane changing project doesn't change what the group check should see.
        if (!tab?.groupId || tab.focusedId !== sessionId) return prev;
        const newProject = projectName(normalized);
        const othersProject = tabGroupProject(
          prev.filter((t) => t.id !== tab.id),
          tab.groupId,
          projectOfTab,
        );
        if (othersProject && newProject && othersProject !== newProject) {
          return removeTabFromGroup(prev, tab.id);
        }
        return prev;
      });
      notifyReviewChanged(sessionId);
    },
    [
      cancel,
      appendTab,
      projectOfTab,
      sessionsRef,
      setProjectCwd,
      setRecents,
      setSessions,
      setTabs,
      setActiveTabId,
      setComposerFocused,
      canDiscardEmptySession,
    ],
  );

  const onSelectWorkspace = useCallback(
    (focus?: WorktreeFocus) => {
      setProjectCwd(sidebarCwdRef.current);
      selectWorkspace(sidebarCwdRef.current, focus);
    },
    [selectWorkspace, setProjectCwd, sidebarCwdRef],
  );

  /**
   * Open a run of folders from one snapshot, committed in a single transition.
   *
   * Planning per folder from refs would read state React has not rendered yet,
   * so the whole run is planned first and applied here in selection order.
   */
  const openProjects = useCallback(
    (paths: readonly string[]) => {
      const steps = planProjectOpenRun({
        memory: readProjectReturnMemory(),
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        activeTabId: activeTabIdRef.current,
        paths,
        canReuseBlank: canDiscardEmptySession,
      });
      const last = steps[steps.length - 1];
      // Dismissing the folder picker (or selecting no valid paths) leaves the
      // current view and any pending workspace navigation untouched.
      if (!last) return;
      cancel();

      // At most one folder can take the blank session, and it keeps the
      // retargeting rules `onCwdChange` already owns.
      const blank = steps.find(
        (step): step is Extract<ProjectOpenStep, { action: "reuse-blank" }> =>
          step.action === "reuse-blank",
      );
      if (blank) onCwdChange(blank.sessionId, blank.path);

      const created = steps.filter(
        (step): step is Extract<ProjectOpenStep, { action: "create" }> =>
          step.action === "create",
      );
      if (created.length > 0) {
        setSessions((prev) => [
          ...prev,
          ...created.map((step) => step.session),
        ]);
        // Each tab sits beside the one before it in the run, so the folders keep
        // their selection order.
        setTabs((prev) =>
          created.reduce(
            (tabs, step) =>
              insertBeside(tabs, step.tab, step.besideTabId, step.path),
            prev,
          ),
        );
      }

      // The folder chosen last ends up focused.
      switch (last.action) {
        case "create":
          setProjectCwd(last.path);
          setActiveTabId(last.tab.id);
          setComposerFocused(true);
          break;
        case "activate":
          setProjectCwd(last.path);
          activateTab(last.tabId, last.paneId);
          break;
        case "keep":
          setProjectCwd(last.path);
          break;
        case "reuse-blank":
          // `onCwdChange` already moved to it.
          break;
      }
      // Every project opened is remembered, the one chosen last most recently.
      for (const step of steps) setRecents(rememberProject(step.path));
    },
    [
      activateTab,
      cancel,
      insertBeside,
      onCwdChange,
      readProjectReturnMemory,
      canDiscardEmptySession,
      activeTabIdRef,
      sessionsRef,
      tabsRef,
      setSessions,
      setTabs,
      setProjectCwd,
      setRecents,
      setActiveTabId,
      setComposerFocused,
    ],
  );

  // The caller's own feedback (a closing picker, the sidebar's project header)
  // paints first; rebuilding the workspace can be interrupted. Until it lands,
  // the previous project's content stays on screen marked as switching.
  const [projectSwitchPending, startProjectSwitch] = useTransition();
  const onSelectProject = useCallback(
    (path: string) => {
      startProjectSwitch(() => {
        cancel();
        openProjects([path]);
        selectProject(path);
      });
    },
    [openProjects, startProjectSwitch, cancel, selectProject],
  );

  const pickProject = useCallback(async () => {
    // Several folders can be taken at once; each opens as its own project, and
    // the last one selected ends up focused.
    openProjects(await pickFolders());
  }, [openProjects]);

  return {
    onCwdChange,
    onSelectWorkspace,
    onSelectProject,
    pickProject,
    projectSwitchPending,
  };
}
