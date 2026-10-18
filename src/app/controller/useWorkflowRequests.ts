import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { workflowActivityIndex } from "../../features/workflows/model/workflowActivity";
import { type WorkflowAppActions } from "../../features/workflows/ui/workflowAppContext";
import {
  leafIds,
  newSubagentTab,
  newWorkflowAgentTab,
  newWorkflowRunTab,
  openEditorTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import type { useSessionSubmission } from "./useSessionSubmission";
import type { useWorkspaceAppViews } from "./useWorkspaceAppViews";
import { requestAddToChat } from "../../features/sessions/model/quoteDraft";
import { type Session } from "../../features/sessions/model/session";
import { type OpenSubagentRequest } from "../../features/sessions/ui/SubagentTabsContext";
import type { RecentProject } from "../../features/projects/model/recents";

type Options = {
  tabs: WorkspaceTab[];
  tabsRef: RefObject<WorkspaceTab[]>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  recents: RecentProject[];
  activeId: string | undefined;
  activeAppView: ReturnType<typeof useWorkspaceAppViews>["activeAppView"];
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  onSubmit: ReturnType<typeof useSessionSubmission>["onSubmit"];
  focusOpenSession: (sessionId: string) => boolean;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  onSelectRemoteSession: WorkflowAppActions["openSession"];
  onNewInProject: (cwd: string, options?: { reuseDraft?: boolean }) => string;
};

/** Workflow, run and subagent tabs, and prompts workflows hand to a conversation. */
export function useWorkflowRequests({
  tabs,
  tabsRef,
  setTabs,
  sessions,
  sessionsRef,
  recents,
  activeId,
  activeAppView,
  setActiveTabId,
  setComposerFocused,
  onSubmit,
  focusOpenSession,
  onSelectHistorySession,
  onSelectRemoteSession,
  onNewInProject,
}: Options) {
  // Workflow and provider subagent tabs open beside their source tab when available,
  // otherwise beside the launching conversation like orchestration workers.
  const [workflowTabRequest, setWorkflowTabRequest] = useState<{
    parentSessionId: string;
    file: FilePaneTab;
    sourceFileId?: string;
  } | null>(null);
  const openSubagentTab = useCallback((request: OpenSubagentRequest) => {
    const { parentSessionId, path, harness, title, cwd, sourceFileId } = request;
    setWorkflowTabRequest({
      parentSessionId,
      file: newSubagentTab(title, cwd, { parentSessionId, path, harness }),
      sourceFileId,
    });
  }, []);
  useEffect(() => {
    if (!workflowTabRequest) return;
    const { parentSessionId, file, sourceFileId } = workflowTabRequest;
    const tab =
      tabs.find((entry) =>
        entry.editorPanes.some((pane) =>
          pane.files.some((file) => file.id === sourceFileId),
        ),
      ) ??
      tabs.find((entry) => leafIds(entry.layout).includes(parentSessionId));
    if (!tab) {
      if (!sessionsRef.current.some((entry) => entry.id === parentSessionId))
        setWorkflowTabRequest(null);
      return;
    }
    setWorkflowTabRequest(null);
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? openEditorTab(entry, file, { afterFileId: sourceFileId })
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workflowTabRequest]);
  const [workflowComposerRequest, setWorkflowComposerRequest] = useState<{
    sessionId: string;
    prompt: string;
  } | null>(null);
  useEffect(() => {
    if (!workflowComposerRequest) return;
    if (activeId !== workflowComposerRequest.sessionId || activeAppView)
      return;
    // Wait until the destination pane is mounted and focused so its composer
    // receives the text, including when onNewInProject reuses an empty chat.
    setWorkflowComposerRequest(null);
    requestAddToChat(workflowComposerRequest.prompt, "plain");
  }, [activeId, activeAppView, workflowComposerRequest]);
  // Complete workflow instructions are sent once their conversation is ready.
  const [workflowSendRequest, setWorkflowSendRequest] = useState<{
    sessionId: string;
    prompt: string;
  } | null>(null);
  useEffect(() => {
    if (!workflowSendRequest) return;
    if (!sessions.some((entry) => entry.id === workflowSendRequest.sessionId))
      return;
    setWorkflowSendRequest(null);
    onSubmit(workflowSendRequest.sessionId, workflowSendRequest.prompt);
  }, [onSubmit, sessions, workflowSendRequest]);
  const workflowProjects = useMemo(
    () =>
      recents.map((project) => ({
        workspacePath: project.path,
        label: project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path,
      })),
    [recents],
  );
  const workflowActivity = useMemo(
    () => workflowActivityIndex(sessions),
    [sessions],
  );
  const workflowApp = useMemo<WorkflowAppActions>(() => {
    const openBesideParent = (
      parentSessionId: string,
      file: FilePaneTab,
      sourceFileId?: string,
    ) => {
      void (async () => {
        const tab = tabsRef.current.find((entry) =>
          entry.editorPanes.some((pane) =>
            pane.files.some((file) => file.id === sourceFileId),
          ),
        ) ?? tabsRef.current.find((entry) => leafIds(entry.layout).includes(parentSessionId));
        if (tab) {
          // Open and focus the destination in the same commit. Activating the
          // parent first briefly restores its composer/hidden surface before
          // the effect below switches focus to the workflow pane.
          setTabs((prev) => prev.map((entry) => entry.id === tab.id
            ? openEditorTab(entry, file, { afterFileId: sourceFileId })
            : entry));
          setActiveTabId(tab.id);
          setComposerFocused(false);
          return;
        }
        if (!focusOpenSession(parentSessionId))
          await onSelectHistorySession(parentSessionId);
        setWorkflowTabRequest({ parentSessionId, file, sourceFileId });
      })().catch(console.error);
    };
    return {
      openRun: (request) =>
        openBesideParent(
          request.parentSessionId,
          newWorkflowRunTab(request.workflowName ?? "Workflow", request.cwd, {
            runId: request.runId,
            parentSessionId: request.parentSessionId,
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            ...(request.workflowName
              ? { workflowName: request.workflowName }
              : {}),
          }),
        ),
      openAgent: (request) =>
        openBesideParent(
          request.parentSessionId,
          newWorkflowAgentTab(request.title, request.cwd, {
            sessionId: request.sessionId,
            parentSessionId: request.parentSessionId,
            runId: request.runId,
          }),
          request.sourceFileId,
        ),
      openSession: (cwd, sessionId) => onSelectRemoteSession(cwd, sessionId),
      createViaChat: (cwd, prompt, options) => {
        const sessionId = onNewInProject(cwd, { reuseDraft: true });
        if (options?.send) setWorkflowSendRequest({ sessionId, prompt });
        else setWorkflowComposerRequest({ sessionId, prompt });
      },
    };
  }, [
    onNewInProject,
    focusOpenSession,
    onSelectHistorySession,
    onSelectRemoteSession,
    setActiveTabId,
    setComposerFocused,
    setTabs,
  ]);

  return { openSubagentTab, workflowProjects, workflowActivity, workflowApp };
}
