import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { ensureSharedProject, projectPath, remoteProjectFor, sessionUsesHost, sharedHostEnvironment } from "../../features/connections/model/remoteProjects";
import { remoteSessionFor } from "../../features/connections/model/connections";
import { isHostSubmissionPreparing, submitHostSession } from "../../features/connections/model/hostSessionSubmission";
import { CHAT_ROOT, chatFolderRelativePath, rememberChatFolder } from "../../features/projects/model/chatFolders";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import { synchronizeProjectLocation, type ProjectLocationSync } from "../../features/projects/model/projectLocation";
import { looksLikeProject } from "../../features/projects/model/recents";
import { sessionExecutionCwd } from "../../domain/session";
import { type Attachment, type Session, type WorktreeCreation } from "../../contracts/session";
import { anchorWorktreeCreation, foldWorktreeCreation, WORKTREE_CREATION_FOLD_MS } from "../../domain/worktreeCreation";
import { createPath } from "../../platform/tauri/fs";
import { isEqualOrInside, pathKey } from "../../shared/lib/paths";
import { showStatusToast } from "../../shared/ui/StatusToast";
import { translate } from "../../shared/i18n/language";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import type { SubmissionAcceptance } from "../model/submissionAcceptance";
import { submitAfterProjectSync } from "../model/submissionAcceptance";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";
import type { Submit, SubmitOptions } from "./workspaceTypes";

async function createChatFolder(): Promise<string> {
  try { return await createPath(`~/${CHAT_ROOT}`, chatFolderRelativePath(), true); }
  catch { return createPath(`~/${CHAT_ROOT}`, chatFolderRelativePath(), true); }
}

type Options = {
  sessionData: Pick<WorkspaceSessionData, "isRemoving">;
  sessionsRef: RefObject<Session[]>;
  navigation: Pick<WorkspaceNavigation, "isSwitching" | "pinSessionToCurrentWorkspace">;
  removingWorktreePaths: RefObject<Set<string>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  submitAfterProjectSyncRef: RefObject<Submit>;
  dismissNoticesForContinuedSession: (sessionId: string) => void;
  projectLocationSyncs: RefObject<Map<string, Promise<ProjectLocationSync | null>>>;
  applyProjectLocationChange: (from: string, to: string) => Promise<void>;
};

/** The controller owns navigation/drafts. Every accepted turn belongs to Host. */
export function useSessionSubmission({ sessionData, sessionsRef, navigation,
  removingWorktreePaths, setSessions, setProjectCwd, submitAfterProjectSyncRef,
  dismissNoticesForContinuedSession, projectLocationSyncs, applyProjectLocationChange }: Options) {
  const preparingChats = useRef(new Set<string>());
  const submitSession = useCallback((sessionId: string, text: string,
    attachments: Attachment[] = [], options?: SubmitOptions): SubmissionAcceptance => {
    const current = sessionsRef.current.find(session => session.id === sessionId);
    const unavailable = () => sessionData.isRemoving(sessionId) || navigation.isSwitching(sessionId);
    if (!current || unavailable() || current.worktreeRemoved ||
      isHostSubmissionPreparing(sessionId) || preparingChats.current.has(sessionId) ||
      [...removingWorktreePaths.current].some(path => isEqualOrInside(sessionExecutionCwd(current), path))) return false;
    const reject = (error: string) => {
      showStatusToast(translate(error), "error");
      options?.onSettled?.({ status: "failed", text: "", error });
      return false;
    };
    if (!text.trim() && !attachments.length && !options?.noteCard && !current.noteCard &&
        !options?.handoffCard && !current.handoffCard) return false;
    if (!remoteProjectFor(current.cwd) && !sharedHostEnvironment())
      return reject("Shared conversation service is not ready. Your message was not sent.");
    if (!sessionUsesHost(current) && !(current.cwd === "~" && isBlankSession(current)))
      return reject("This conversation must be migrated to the shared Host before sending.");
    if ((options?.managed || options?.ciRepair || options?.appRequestId) &&
        (current.busy || current.pendingSwitch || current.pendingConfiguration))
      return reject("Session is unavailable or already running");
    if (!options?.projectLocationReady && looksLikeProject(current.cwd) && !current.executionCwd) {
      const key = pathKey(current.cwd);
      let sync = projectLocationSyncs.current.get(key);
      if (!sync) {
        sync = synchronizeProjectLocation(current.cwd);
        projectLocationSyncs.current.set(key, sync);
        void sync.then(() => projectLocationSyncs.current.delete(key), () => projectLocationSyncs.current.delete(key));
      }
      return submitAfterProjectSync({ cwd: current.cwd, sync, applyLocationChange: applyProjectLocationChange,
        submit: () => submitAfterProjectSyncRef.current(sessionId, text, attachments, { ...options, projectLocationReady: true }),
        onError: error => { reject(error instanceof Error ? error.message : String(error)); },
      });
    }
    preparingChats.current.add(sessionId);
    return (async () => {
      let target = current;
      if (current.cwd === "~") {
        let path: string;
        try {
          path = await createChatFolder();
          await ensureSharedProject(path);
        } catch (error) {
          return reject(error instanceof Error ? error.message : "The chat folder could not be created.");
        }
        const latest = sessionsRef.current.find(session => session.id === sessionId);
        if (!latest || latest.cwd !== "~" || !isBlankSession(latest) || unavailable())
          return reject("Session is unavailable or already running");
        target = { ...latest, cwd: path };
      }
      // Git's live output belongs under the message being sent, as the Host
      // will record it; the optimistic message is replaced by the Host's copy.
      let optimisticId: string | undefined;
      const dropOptimistic = () => {
        const id = optimisticId;
        if (!id || remoteSessionFor(sessionId)) return;
        setSessions(sessions => sessions.map(session => session.id === sessionId
          ? { ...session, worktreeCreation: undefined, blocks: session.blocks.filter(block => !(block.id === id && block.sending)) }
          : session));
      };
      const showWorktreeCreation = (creation: WorktreeCreation, commandId: string) => {
        if (unavailable()) return;
        optimisticId = commandId;
        setSessions(sessions => sessions.map(session => {
          if (session.id !== sessionId) return session;
          if (creation.status === "failed")
            return { ...session, worktreeCreation: undefined,
              blocks: session.blocks.filter(block => !(block.id === commandId && block.sending)) };
          const blocks = session.blocks.some(block => block.id === commandId) ? session.blocks
            : [...session.blocks, { id: commandId, role: "user" as const, text, sending: true }];
          return { ...session, blocks, worktreeCreation: anchorWorktreeCreation(creation, creation.id, commandId) };
        }));
        if (creation.status === "created") window.setTimeout(() => setSessions(sessions => sessions.map(session =>
          session.id === sessionId && session.worktreeCreation
            ? { ...session, worktreeCreation: foldWorktreeCreation(session.worktreeCreation, creation.id) }
            : session)), WORKTREE_CREATION_FOLD_MS);
      };
      try {
        const accepted = await submitHostSession(target, text, attachments, { ...options, onWorktreeCreation: showWorktreeCreation }, snapshot => {
          if (unavailable()) return;
          // Only Host projections change transcript state; preserve the shell's
          // workspace path and identity used by the surrounding pane layout.
          const project = remoteProjectFor(target.cwd);
          setSessions(sessions => sessions.map(session => session.id === sessionId
            ? { ...snapshot.session, id: sessionId, cwd: target.cwd,
                worktreeCreation: snapshot.session.worktreeCreation ?? session.worktreeCreation,
                executionCwd: snapshot.session.executionCwd && project
                  ? projectPath(project, snapshot.session.executionCwd) : target.executionCwd }
            : session));
        });
        if (!accepted) {
          dropOptimistic();
          // Managed callers wait for exactly one terminal outcome.
          options?.onSettled?.({ status: "failed", text: "", error: "Session is unavailable or already running" });
          return false;
        }
        if (current.cwd === "~") {
          rememberChatFolder(target.cwd);
          const next = sessionsRef.current.map(session => session.id === sessionId ? { ...session, cwd: target.cwd } : session);
          sessionsRef.current = next;
          setSessions(sessions => sessions.map(session => session.id === sessionId ? { ...session, cwd: target.cwd } : session));
          setProjectCwd(cwd => cwd === "~" ? target.cwd : cwd);
        }
        dismissNoticesForContinuedSession(sessionId);
        return true;
      } catch (error) {
        dropOptimistic();
        // Create may have succeeded before the send response was lost. Keep
        // that binding reachable so its durable pending send can be retried.
        if (current.cwd === "~" && remoteSessionFor(sessionId)) {
          rememberChatFolder(target.cwd);
          setSessions(sessions => sessions.map(session => session.id === sessionId ? { ...session, cwd: target.cwd } : session));
          setProjectCwd(cwd => cwd === "~" ? target.cwd : cwd);
        }
        showStatusToast(translate(error instanceof Error ? error.message : String(error)), "error");
        return false;
      }
    })().finally(() => preparingChats.current.delete(sessionId));
  }, [sessionData, navigation, dismissNoticesForContinuedSession, setSessions, setProjectCwd]);
  submitAfterProjectSyncRef.current = submitSession;
  const onSubmit = useCallback((...args: Parameters<Submit>): boolean => {
    const result = submitSession(...args);
    if (typeof result === "boolean") return result;
    void result.then(accepted => { if (!accepted) args[3]?.onSubmissionRejected?.(); },
      () => args[3]?.onSubmissionRejected?.());
    return true;
  }, [submitSession]);
  return { submitSession, onSubmit };
}
