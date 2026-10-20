import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { nudgeWatchedFiles } from "../../features/connections/files/model/fileWatch";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../features/connections/model/remoteSessionActions";
import { inboxAskPrompt } from "../../features/inbox/model/inboxAsk";
import { composeNoteMessage } from "../../features/notes";
import { syncDockBadge } from "../../features/notifications/model/dockBadge";
import { announceSessionFinished } from "../../features/notifications/model/notifications";
import {
  orchestrator,
  shellPath,
  type ControlOutcome,
} from "../../features/orchestration/model/orchestration";
import { discoverOrchestrationSettings } from "../../features/orchestration/model/orchestrationCatalog";
import {
  completeOrRepairOrchestrationProposal,
  completeOrchestrationProposal,
  orchestrationPlanningPrompt,
  orchestrationRepairPrompt,
  proposalBlock,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "../../features/orchestration/model/orchestrationPlan";
import {
  CHAT_ROOT,
  chatFolderRelativePath,
  rememberChatFolder,
} from "../../features/projects/model/chatFolders";
import type { ProjectLocationSync } from "../../features/projects/model/projectLocation";
import { synchronizeProjectLocation } from "../../features/projects/model/projectLocation";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import { looksLikeProject } from "../../features/projects/model/recents";
import {
  conversationProviderAccountId,
  providerAccountExists,
  selectedProviderAccountId,
  workBuddyAccountIdForModel,
  supportsProviderAccounts,
} from "../../features/providers/model/providerAccounts";
import {
  displayAttachments,
  prepareAttachments,
} from "../../features/sessions/model/attachments";
import {
  beginSessionTurn,
  finishSessionTurn,
  flushSessionCheckpoint,
  notifyReviewChanged,
} from "../../features/sessions/model/checkpoint";
import { sessionEditPaths } from "../../features/sessions/model/checkpointEdits";
import type { EditedResendCoordinator } from "../../features/sessions/model/editLastTurn";
import { createEditedResendAttempt } from "../../features/sessions/model/editLastTurn";
import {
  appendPreparingHandoff,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  handoffTurnCard,
  isPreparingHandoff,
  pendingHandoff,
  shouldAskOutgoingAgent,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "../../features/sessions/model/handoff";
import { requestOutgoingHandoff } from "../../features/sessions/model/handoffTurn";
import { CONTINUE_PROMPT } from "../../features/sessions/model/inFlight";
import {
  dequeueQueuedMessage,
  insertQueuedMessage,
  queuedMessageForSubmit,
} from "../../features/sessions/model/messageQueue";
import {
  resolveModel,
  saveRecentModelChoice,
} from "../../features/sessions/model/models";
import {
  consumeOperatorCommand,
  operatorEnabledInThread,
} from "../../features/sessions/model/operatorCommand";
import {
  buildPlanPrompt,
  isProviderFailureText,
  planTurnKey,
  planTurnPrompt,
} from "../../features/sessions/model/plan";
import { preparePrompt } from "../../features/sessions/model/promptPreparation";
import {
  questionFollowUp,
  recordQuestionAnswer,
} from "../../features/sessions/model/questionHistory";
import { SECOND_OPINION_TITLE } from "../../features/sessions/model/secondOpinion";
import {
  HARNESS_LABEL,
  canReplaceSessionTitle,
  sessionExecutionCwd,
  titleFromPrompt,
  type Attachment,
  type Session,
} from "../../features/sessions/model/session";
import { resolveLinkedWorkItem } from "../../features/sessions/model/sessionWorkItem";
import { loadFollowUpBehavior } from "../../features/settings/model/settings";
import { isNativeCommandPrompt } from "../../features/skills/model/skills";
import { createTaskWorktree } from "../../features/source-control/model/taskWorktree";
import {
  WORKTREE_CREATION_FOLD_MS,
  anchorWorktreeCreation,
  appendWorktreeCreationLog,
  completeWorktreeCreation,
  failWorktreeCreation,
  foldWorktreeCreation,
  persistWorktreeCreation,
  startWorktreeCreation,
} from "../../features/source-control/model/worktreeCreation";
import {
  appendSteerUser,
  appendUser,
  canRewindHarnessLastTurn,
  canSteerHarness,
  cancelHarnessTurn,
  forgetHarnessSession,
  isLiveHarness,
  promoteLastAssistantToPlan,
  rewindHarnessLastTurn,
  sendHarnessTurn,
  steerHarnessTurn,
  stopHarnessSession,
  stopStreaming,
  type HarnessEvent,
} from "../../integrations/harness";
import { SessionTitleCoordinator } from "../../integrations/harness/core/titleCoordinator";
import { createPath, notifyGitChanged } from "../../platform/tauri/fs";
import { isEqualOrInside, pathKey } from "../../shared/lib/paths";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import {
  nudgeOpenEditors,
  nudgeWorkspace,
  trackSessionEdits,
} from "../model/sessionEditTracking";
import {
  lastAssistantTextInTurn,
  userTurnCards,
  withPlanBuildTarget,
  withPlanStatus,
} from "../model/sessionTransforms";
import {
  submitAfterProjectSync,
  type SubmissionAcceptance,
} from "../model/submissionAcceptance";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";
import type { Submit, SubmitOptions } from "./workspaceTypes";

async function createChatFolder(): Promise<string> {
  try {
    return await createPath(`~/${CHAT_ROOT}`, chatFolderRelativePath(), true);
  } catch {
    // The random suffix collided within the same second; draw again once.
    return createPath(`~/${CHAT_ROOT}`, chatFolderRelativePath(), true);
  }
}

type Options = {
  sessionData: Pick<WorkspaceSessionData, "isRemoving">;
  sessionsRef: RefObject<Session[]>;
  editedResends: EditedResendCoordinator;
  flushHarnessEvents: () => void;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  navigation: Pick<
    WorkspaceNavigation,
    "isSwitching" | "pinSessionToCurrentWorkspace"
  >;
  removingWorktreePaths: RefObject<Set<string>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  submitAfterProjectSyncRef: RefObject<Submit>;
  dismissNoticesForContinuedSession: (sessionId: string) => void;
  projectLocationSyncs: RefObject<
    Map<string, Promise<ProjectLocationSync | null>>
  >;
  applyProjectLocationChange: (from: string, to: string) => Promise<void>;
  turnGen: RefObject<Map<string, number>>;
  titleCoordinator: RefObject<SessionTitleCoordinator | null>;
  activeSessionIdRef: RefObject<string | undefined>;
};

export function useSessionSubmission({
  sessionData,
  sessionsRef,
  editedResends,
  flushHarnessEvents,
  enqueueHarnessEvent,
  navigation,
  removingWorktreePaths,
  setSessions,
  setProjectCwd,
  submitAfterProjectSyncRef,
  dismissNoticesForContinuedSession,
  projectLocationSyncs,
  applyProjectLocationChange,
  turnGen,
  titleCoordinator,
  activeSessionIdRef,
}: Options) {
  const submitSession = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: SubmitOptions,
    ): SubmissionAcceptance => {
      const remote = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (remote && sessionUsesHost(remote))
        return !!remoteSessionActions(sessionId)?.submit(
          text,
          attachments,
          options,
        );
      if (["orchestrate"].includes(options?.intent ?? "")) return false;
      if (editedResends.isActive(sessionId)) return false;
      // Output already received belongs before the submitted user message.
      // Flush before reading the session too, since pending errors can settle it.
      flushHarnessEvents();
      const controlError = orchestrator.submissionError(
        sessionId,
        options?.managed,
      );
      if (controlError) {
        enqueueHarnessEvent(sessionId, { type: "status", text: controlError });
        flushHarnessEvents();
        return false;
      }
      if (options?.managed) {
        const target = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !target ||
          target.busy ||
          target.pendingSwitch ||
          isPreparingHandoff(target) ||
          sessionData.isRemoving(sessionId)
        ) {
          options.onSettled?.({
            status: "failed",
            text: "",
            error: "Session is unavailable or already running",
          });
          return false;
        }
      }
      if (
        sessionData.isRemoving(sessionId) ||
        navigation.isSwitching(sessionId)
      )
        return false;
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (options?.appRequestId && storedCurrent?.busy) return false;
      if (
        options?.ciRepair &&
        storedCurrent &&
        (storedCurrent.busy ||
          storedCurrent.pendingSwitch ||
          storedCurrent.pendingConfiguration ||
          isPreparingHandoff(storedCurrent))
      )
        return false;
      if (
        !storedCurrent ||
        storedCurrent.worktreeRemoved ||
        [...removingWorktreePaths.current].some((path) =>
          isEqualOrInside(sessionExecutionCwd(storedCurrent), path),
        )
      )
        return false;
      // A projectless chat gets its own dated folder when its first message is sent.
      if (
        storedCurrent.cwd === "~" &&
        !options?.managed &&
        isBlankSession(storedCurrent)
      ) {
        return (async () => {
          let path: string;
          try {
            path = await createChatFolder();
          } catch (error: unknown) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message:
                error instanceof Error
                  ? error.message
                  : "The chat folder could not be created.",
            });
            flushHarnessEvents();
            return false;
          }
          rememberChatFolder(path);
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId && session.cwd === "~"
              ? { ...session, cwd: path }
              : session,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          setProjectCwd((current) => (current === "~" ? path : current));
          return await submitAfterProjectSyncRef.current(
            sessionId,
            text,
            attachments,
            options,
          );
        })();
      }
      const draftBlock = options?.draftBlockId
        ? storedCurrent.blocks.find(
            (block) =>
              block.id === options.draftBlockId &&
              block.role === "user" &&
              block.draft,
          )
        : undefined;
      if (options?.draftBlockId && !draftBlock) return false;
      const draftCleared = draftBlock
        ? {
            ...storedCurrent,
            blocks: storedCurrent.blocks.filter(
              (block) => block.id !== draftBlock.id,
            ),
          }
        : storedCurrent;
      const turnTarget =
        options?.buildTarget ?? draftCleared.pendingConfiguration;
      let current = turnTarget
        ? withPlanBuildTarget(
            {
              ...draftCleared,
              runtimeMode:
                draftCleared.pendingConfiguration?.runtimeMode ??
                draftCleared.runtimeMode,
            },
            turnTarget,
          )
        : draftCleared;
      const editedResend = options?.resendEdited
        ? createEditedResendAttempt(current, options.onResendRejected)
        : undefined;
      if (options?.resendEdited && !editedResend) return false;
      const editedProviderTurnId = editedResend?.providerTurnId;
      if (editedResend) {
        current = { ...current, blocks: editedResend.blocks };
      }
      const intent = options?.intent ?? "default";
      if (intent === "orchestrate") {
        try {
          const run = orchestrator.forSession(sessionId);
          if (run && ["active", "paused"].includes(run.status))
            throw new Error(
              "Stop the current orchestration run before preparing another proposal.",
            );
        } catch (error) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: error instanceof Error ? error.message : String(error),
          });
          flushHarnessEvents();
          return false;
        }
      }
      const approvedPlan = options?.planBlockId
        ? current.blocks.find(
            (block) =>
              block.id === options.planBlockId && block.role === "plan",
          )
        : undefined;
      if (intent === "build" && !approvedPlan?.text.trim()) return false;
      if (options?.queuedMessageId) {
        const mode =
          options.followUpBehavior === "steer" ? "steer" : "dispatch";
        if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
          return false;
        }
      }
      const noteCard =
        options && "noteCard" in options ? options.noteCard : current.noteCard;
      const handoffCard =
        options && "handoffCard" in options
          ? options.handoffCard
          : current.handoffCard;
      if (
        !text.trim() &&
        attachments.length === 0 &&
        !noteCard &&
        !handoffCard
      ) {
        return false;
      }
      if (isPreparingHandoff(current)) return false;
      saveRecentModelChoice(current.harness, current.model);
      const initialWorkCwd = sessionExecutionCwd(current);
      const createDraftWorktree =
        current.workspaceMode === "worktree";
      const creationId = crypto.randomUUID();
      const accountProvider = supportsProviderAccounts(current.harness)
        ? current.harness
        : undefined;
      const providerAccountId = accountProvider
        ? (conversationProviderAccountId(current) ??
          (accountProvider === "workbuddy" ? workBuddyAccountIdForModel(current.model, selectedProviderAccountId(accountProvider, current.cwd)) : selectedProviderAccountId(accountProvider, current.cwd)))
        : undefined;
      if (
        accountProvider &&
        providerAccountId &&
        !providerAccountExists(accountProvider, providerAccountId)
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "session.error",
          message:
            "This conversation uses a removed provider account. Switch accounts from the usage control to start a new conversation.",
        });
        flushHarnessEvents();
        return false;
      }
      const submittedText = intent === "build" ? "Build approved plan" : text;
      const operatorCommand = consumeOperatorCommand(submittedText);
      if (
        operatorCommand.matched &&
        (intent !== "default" ||
          current.orchestrationLeadId ||
          current.inboxAsk ||
          orchestrator.run(sessionId))
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Use /operator from a regular session turn, outside an orchestration run.",
        });
        flushHarnessEvents();
        return false;
      }
      const operatorAccess =
        operatorCommand.matched || operatorEnabledInThread(current.blocks);
      const promptText = operatorCommand.matched
        ? operatorCommand.text.trim() ||
          "Explain what you can do in OmniCode with the app CLI."
        : submittedText;
      const rawCommand =
        !operatorCommand.matched &&
        isNativeCommandPrompt(submittedText, current.harness);
      const ciContext = options?.ciRepair?.prompt ?? options?.ciContext;
      const harnessText =
        options?.ciRepair?.prompt ??
        (rawCommand ? submittedText : composeNoteMessage(noteCard, promptText));

      const pendingSwitch =
        current.pendingSwitch && current.pendingSwitch.from !== current.harness
          ? current.pendingSwitch
          : null;

      if ((current.busy || (options?.queueReturnPosition && current.queuedMessages?.length)) && !pendingSwitch) {
        if (
          operatorCommand.matched &&
          options?.queuedMessageId &&
          options.followUpBehavior === "steer"
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "/operator starts a new turn after the current turn finishes.",
          });
          flushHarnessEvents();
          return false;
        }
        const followUpBehavior =
          options?.queueReturnPosition ||
          current.worktreePreparing ||
          intent === "plan" ||
          intent === "orchestrate" ||
          operatorCommand.matched
            ? "queue"
            : // The agent has yielded and only background work is left, which
              // may never end (a dev server). Queuing would park the message
              // behind it, so hand it to the agent now.
              current.backgroundTasks?.length
              ? "steer"
              : (options?.followUpBehavior ?? loadFollowUpBehavior());
        if (followUpBehavior === "queue") {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    inboxCard: rawCommand ? s.inboxCard : undefined,
                    noteCard: rawCommand ? s.noteCard : undefined,
                    handoffCard: rawCommand ? s.handoffCard : undefined,
                    queuedMessages: insertQueuedMessage(s, {
                      id: crypto.randomUUID(),
                      text,
                      attachments,
                      noteCard,
                      handoffCard,
                      intent,
                    }, options?.queueReturnPosition),
                    queueStatus:
                      s.queueStatus === "paused" ? "paused" : "active",
                  }
                : s,
            ),
          );
          dismissNoticesForContinuedSession(sessionId);
          return true;
        }
        if (
          !isLiveHarness(current.harness) ||
          !canSteerHarness(current.harness)
        ) {
          // Harnesses that cannot steer (fx) used to drop the message on the
          // floor here, so a follow-up sent mid-turn just vanished. Say so.
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: `${current.harness} cannot take a follow-up mid-turn — wait for this turn to finish, or stop it first.`,
          });
          flushHarnessEvents();
          return false;
        }
        dismissNoticesForContinuedSession(sessionId);
        const visible = displayAttachments(attachments);
        const cards = { ...userTurnCards(noteCard), ...(options?.queuedMessageId ? { id: options.queuedMessageId } : {}) };
        const nextSessions = sessionsRef.current.map((s) => {
          if (s.id !== sessionId) return s;
          let next: Session = {
            ...s,
            inboxCard: rawCommand ? s.inboxCard : undefined,
            noteCard: rawCommand ? s.noteCard : undefined,
            handoffCard: rawCommand ? s.handoffCard : undefined,
          };
          if (options?.queuedMessageId) {
            next = dequeueQueuedMessage(next, options.queuedMessageId);
          }
          return appendSteerUser(next, submittedText, visible, cards);
        });
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = await preparePrompt(harnessText, {
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
            });
            await steerHarnessTurn({
              harness: current.harness,
              nativeSession: current.nativeSession,
              sessionId,
              cwd: initialWorkCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              text: inboxAskPrompt(
                rawCommand ? undefined : current.inboxAsk,
                prompt,
              ),
              attachments: prepared,
            });
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? error.message
                : `${current.harness} could not steer the active turn`;
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
          }
        })();
        return true;
      }

      if (
        !options?.projectLocationReady &&
        looksLikeProject(current.cwd) &&
        !current.executionCwd
      ) {
        const key = pathKey(current.cwd);
        let sync = projectLocationSyncs.current.get(key);
        if (!sync) {
          sync = synchronizeProjectLocation(current.cwd);
          projectLocationSyncs.current.set(key, sync);
          void sync.then(
            () => projectLocationSyncs.current.delete(key),
            () => projectLocationSyncs.current.delete(key),
          );
        }
        return submitAfterProjectSync({
          cwd: current.cwd,
          sync,
          applyLocationChange: applyProjectLocationChange,
          submit: async () => {
            const accepted = await submitAfterProjectSyncRef.current(
              sessionId,
              text,
              attachments,
              { ...options, projectLocationReady: true },
            );
            if (!accepted) {
              editedResend?.reject();
              options?.onSettled?.({
                status: "failed",
                text: "",
                error:
                  "The chat became unavailable before the request could start. Try again when it is ready.",
              });
            }
            return accepted;
          },
          onError: (error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : "The project folder could not be opened.";
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
            editedResend?.reject();
            options?.onSettled?.({
              status: "failed",
              text: "",
              error: message,
            });
          },
        });
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const proposalId =
        intent === "orchestrate" ? crypto.randomUUID() : undefined;
      let proposalDraft: OrchestrationProposal | undefined = proposalId
        ? {
            version: 1,
            leadId: sessionId,
            cwd: current.cwd,
            checkoutCwd: initialWorkCwd,
            request: harnessText,
            author: {
              harness: current.harness,
              model: current.model,
              name: resolveModel(current.harness, current.model).name,
            },
            settings: { choices: [], maxWorkers: 2 },
            status: "planning",
            title: "Orchestration plan",
            summary: "",
            tasks: [],
          }
        : undefined;
      const isFirstTurn = current.blocks.every(
        (block) => block.draft || block.internal,
      );
      const placeholderTitle =
        canReplaceSessionTitle(
          current.title,
          current.harness,
          HARNESS_LABEL[current.harness],
        ) || !!draftBlock;
      const titleSeed =
        isFirstTurn &&
        !current.inboxCard &&
        !current.noteCard &&
        placeholderTitle
          ? titleFromPrompt(
              operatorCommand.matched ? promptText : submittedText,
              current.harness,
              attachments,
            )
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ??
        (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText = operatorCommand.matched
        ? promptText
        : card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText;
      const checkpointId = crypto.randomUUID();
      const cards = {
        ...(options?.queuedMessageId ? { id: options.queuedMessageId } : {}),
        checkpointTurnId: checkpointId,
        ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
        ...(ciContext ? { ciContext } : {}),
        ...(operatorCommand.matched ? { omnicode: true } : {}),
        ...(intent === "plan" || intent === "orchestrate" ? { intent } : {}),
        ...(options?.appRequestId
          ? { appRequestId: options.appRequestId }
          : {}),
        // The orchestrator writes these turns, not the user; hide them.
        ...(options?.managed ? { internal: true } : {}),
      };
      const live = isLiveHarness(current.harness);
      const queuedHandoff =
        live && !pendingSwitch ? pendingHandoff(current) : null;

      if (pendingSwitch && current.busy) {
        void cancelHarnessTurn(pendingSwitch.from, sessionId);
      }

      dismissNoticesForContinuedSession(sessionId);
      const commitSubmittedTurn = () => {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const draftRemoved = draftBlock
              ? {
                  ...s,
                  blocks: s.blocks.filter(
                    (block) => block.id !== draftBlock.id,
                  ),
                }
              : s;
            const selected = turnTarget
              ? withPlanBuildTarget(
                  { ...draftRemoved, runtimeMode: current.runtimeMode },
                  turnTarget,
                )
              : draftRemoved;
            const titled = isFirstTurn ? titleSeed : selected.title;
            let next: Session = {
              ...selected,
              providerAccountId,
              usageLimit: undefined,
              // Only a live harness reaches the creation below; otherwise the
              // preparing flags would never clear.
              worktreePreparing:
                createDraftWorktree && live ? true : selected.worktreePreparing,
              worktreeCreation:
                createDraftWorktree && live
                  ? startWorktreeCreation(
                      current.worktreeBase || "HEAD",
                      creationId,
                    )
                  : selected.worktreeCreation,
              inboxCard:
                rawCommand || options?.ciRepair ? s.inboxCard : undefined,
              noteCard:
                rawCommand || options?.ciRepair ? s.noteCard : undefined,
              handoffCard:
                rawCommand || options?.ciRepair ? s.handoffCard : undefined,
            };
            if (editedResend) {
              next = editedResend.replace(next);
            }
            if (approvedPlan && intent === "build") {
              next = {
                ...next,
                blocks: next.blocks.map((block) =>
                  block.id === approvedPlan.id && block.role === "plan"
                    ? {
                        ...block,
                        plan: {
                          ...(block.plan ?? { status: "ready" as const }),
                          status: "building" as const,
                          approvedText: block.text,
                        },
                      }
                    : block,
                ),
              };
            }
            if (options?.queuedMessageId) {
              next = dequeueQueuedMessage(next, options.queuedMessageId);
            }
            if (!live) {
              return {
                ...next,
                title: titled,
                pendingSwitch: undefined,
                busy: false,
                blocks: [
                  ...next.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text: visibleText,
                    ...(visible.length > 0 ? { attachments: visible } : {}),
                    ...cards,
                  },
                  {
                    id: crypto.randomUUID(),
                    role: "system",
                    text: `${next.harness} is not connected yet — install and sign in to that provider, then retry.`,
                    notice: "error",
                  },
                ],
              };
            }
            if (pendingSwitch) {
              const sealed = stopStreaming({
                ...next,
                title: titled,
                pendingSwitch: undefined,
              });
              return appendUser(
                appendPreparingHandoff(
                  sealed,
                  pendingSwitch.from,
                  next.harness,
                ),
                visibleText,
                visible,
                cards,
              );
            }
            return appendUser(
              { ...next, title: titled },
              visibleText,
              visible,
              cards,
            );
          }),
        );
      };
      if (!options?.resendEdited) {
        flushSync(commitSubmittedTurn);
      }
      if (createDraftWorktree && live) {
        // The creation record hangs under the message this send just committed.
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== sessionId || !session.worktreeCreation)
              return session;
            const message = [...session.blocks]
              .reverse()
              .find((block) => block.role === "user");
            return message
              ? {
                  ...session,
                  worktreeCreation: anchorWorktreeCreation(
                    session.worktreeCreation,
                    creationId,
                    message.id,
                  ),
                }
              : session;
          }),
        );
      }

      const launchTitleGeneration = (workCwd: string) => {
        if (!live) return;
        const titleMessage =
          harnessText || attachments.map((file) => file.name).join(", ");
        if ((isFirstTurn && placeholderTitle) || options?.refreshTitle)
          titleCoordinator.current!.begin(
            sessionId,
            titleMessage,
            !!options?.refreshTitle,
          );
        else void titleCoordinator.current!.read(sessionId);
        void resolveLinkedWorkItem(titleMessage, workCwd, null)
          .then((linkedWorkItem) => {
            if (!linkedWorkItem) return;
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && !session.linkedWorkItem
                  ? { ...session, linkedWorkItem }
                  : session,
              ),
            );
          })
          .catch(() => undefined);
      };

      if (!live) {
        if (pendingSwitch) {
          void forgetHarnessSession(pendingSwitch.from, sessionId);
        }
        editedResend?.reject();
        options?.onSettled?.({
          status: "failed",
          text: "",
          error: "Harness is not connected",
        });
        return true;
      }
      if (editedResend && canRewindHarnessLastTurn(current.harness)) {
        editedResends.start(sessionId);
        const locked = sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, busy: true } : session,
        );
        sessionsRef.current = locked;
        syncDockBadge(locked);
        setSessions(locked);
      }

      if (proposalId && proposalDraft) {
        const draft = proposalDraft;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  blocks: [...session.blocks, proposalBlock(proposalId, draft)],
                }
              : session,
          ),
        );
      }

      let controlOutcome: ControlOutcome = {
        status: "failed",
        text: "",
        error: "Turn did not complete",
      };
      let controlText = "";
      let proposalText = "";
      let nativeProposalText = "";
      let completedProposal: OrchestrationProposal | undefined;
      void (async () => {
        let workCwd = initialWorkCwd;
        if (createDraftWorktree) {
          const tree = await createTaskWorktree(
            current.cwd,
            current.harness,
            harnessText || attachments.map((file) => file.name).join(", "),
            current.worktreeBase || "HEAD",
            {
              id: creationId,
              onLine: (line) =>
                setSessions((prev) =>
                  prev.map((session) =>
                    session.id === sessionId && session.worktreeCreation
                      ? {
                          ...session,
                          worktreeCreation: appendWorktreeCreationLog(
                            session.worktreeCreation,
                            creationId,
                            line,
                          ),
                        }
                      : session,
                  ),
                ),
            },
            () => turnGen.current.get(sessionId) === gen,
          );
          if (!tree) {
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && session.worktreeCreation
                  ? {
                      ...session,
                      worktreeCreation: failWorktreeCreation(
                        session.worktreeCreation,
                        creationId,
                        "Worktree creation cancelled.",
                      ),
                    }
                  : session,
              ),
            );
            return;
          }
          workCwd = tree.path;
          navigation.pinSessionToCurrentWorkspace(sessionId, current.cwd);
          if (proposalDraft)
            proposalDraft = { ...proposalDraft, checkoutCwd: tree.path };
          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== sessionId) return session;
              const completed = session.worktreeCreation
                ? completeWorktreeCreation(
                    session.worktreeCreation,
                    creationId,
                    tree.path,
                  )
                : undefined;
              const record = completed
                ? persistWorktreeCreation(completed)
                : undefined;
              return {
                ...session,
                executionCwd: tree.path,
                linkedWorktree: !tree.isMain,
                branch: tree.branch ?? undefined,
                workspaceMode: undefined,
                worktreeBase: undefined,
                worktreePreparing: undefined,
                worktreeCreation: completed,
                // The agent's clock starts now, not at the send, so the worktree
                // time is not counted as work. The finished record stays with its
                // message, so its log survives a reload.
                blocks: session.blocks.map((block) =>
                  block.id === session.worktreeCreation?.afterBlockId
                    ? {
                        ...block,
                        startedAt: Date.now(),
                        ...(record ? { worktreeCreation: record } : {}),
                      }
                    : block,
                ),
              };
            }),
          );
          // The log stays readable for a moment, then folds away.
          window.setTimeout(() => {
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && session.worktreeCreation
                  ? {
                      ...session,
                      worktreeCreation: foldWorktreeCreation(
                        session.worktreeCreation,
                        creationId,
                      ),
                    }
                  : session,
              ),
            );
          }, WORKTREE_CREATION_FOLD_MS);
          notifyReviewChanged(sessionId);
        }
        launchTitleGeneration(workCwd);
        if (turnGen.current.get(sessionId) !== gen) return;
        if (proposalDraft && proposalId) {
          const settings = await discoverOrchestrationSettings();
          if (turnGen.current.get(sessionId) !== gen) return;
          proposalDraft = { ...proposalDraft, settings };
          const discovering = proposalDraft;
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? withOrchestrationProposal(session, proposalId, discovering)
                : session,
            ),
          );
        }
        let wrap = handoffCard
          ? {
              from: handoffCard.from,
              to: current.harness,
              text: handoffCard.brief,
            }
          : queuedHandoff;
        if (pendingSwitch) {
          let agentText = "";
          if (
            shouldAskOutgoingAgent(current) &&
            isLiveHarness(pendingSwitch.from)
          ) {
            try {
              agentText = await requestOutgoingHandoff({
                harness: pendingSwitch.from,
                sessionId,
                cwd: workCwd,
                model: pendingSwitch.fromModel,
                modelSettings: pendingSwitch.fromSettings,
                providerAccountId: pendingSwitch.fromProviderAccountId,
                userRequest: text,
              });
            } catch {
              agentText = "";
            }
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          const latest = sessionsRef.current.find((s) => s.id === sessionId);
          const brief = chooseHandoffBrief(agentText, latest ?? current, text);
          await forgetHarnessSession(pendingSwitch.from, sessionId);
          if (turnGen.current.get(sessionId) !== gen) return;
          wrap = { from: pendingSwitch.from, to: current.harness, text: brief };
        }

        const revealHandoff = (brief: string) => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
              return { ...completeHandoff(s, brief), busy: true };
            }),
          );
        };

        const planEventKey = planTurnKey(gen);
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
          if (event.type === "session.error") providerFailureSeen = true;
          if (proposalDraft) {
            if (event.type === "message.delta") {
              proposalText = (proposalText + event.text).slice(-200_000);
              return null;
            }
            if (event.type === "message.completed") {
              proposalText += "\n";
              return null;
            }
            if (event.type === "plan") {
              nativeProposalText = event.append
                ? nativeProposalText + event.text
                : event.text;
              return null;
            }
          }
          if (intent !== "plan") return event;
          if (event.type === "plan") {
            nativePlanSeen = true;
            return {
              ...event,
              key: planEventKey,
            };
          }
          return event;
        };

        const pendingEditedEvents: HarnessEvent[] = [];
        const applyTurnEvent = (event: HarnessEvent) => {
          orchestrator.observe(sessionId, event);
          if (options?.onSettled && event.type === "message.delta")
            controlText = (controlText + event.text).slice(-20_000);
          if (options?.onSettled && event.type === "message.completed")
            controlText += "\n";
          if (event.type === "session.error")
            controlOutcome.error = event.message;
          if (
            wrap &&
            (event.type === "session.started" ||
              event.type === "session.providerBound")
          ) {
            revealHandoff(wrap.text);
          }
          nudgeOpenEditors(event, workCwd);
          if (!orchestrator.forSession(sessionId))
            trackSessionEdits(sessionId, workCwd, event);
          const routed = routePlanEvent(event);
          if (routed) enqueueHarnessEvent(sessionId, routed);
        };
        const routeTurnEvent = (event: HarnessEvent) => {
          if (
            event.type === "session.titleUpdated" ||
            event.type === "session.titleRefreshRequested"
          ) {
            flushHarnessEvents();
            const session = sessionsRef.current.find((s) => s.id === sessionId);
            if (
              session?.harness === current.harness &&
              session.providerSessionId === event.providerSessionId &&
              (session.providerAccountId ?? "default") ===
                (providerAccountId ?? "default")
            ) {
              if (event.type === "session.titleUpdated")
                titleCoordinator.current!.native(
                  sessionId,
                  event.providerSessionId,
                  event.title,
                );
              else void titleCoordinator.current!.read(sessionId);
            }
            return;
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          if (editedResend && !editedResend.isAccepted()) {
            pendingEditedEvents.push(event);
            return;
          }
          applyTurnEvent(event);
        };
        const acceptEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          flushSync(commitSubmittedTurn);
          editedResend.markAccepted();
          for (const event of pendingEditedEvents) applyTurnEvent(event);
          pendingEditedEvents.length = 0;
        };
        const recoverEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          pendingEditedEvents.length = 0;
          const previous = sessionsRef.current.find(
            (session) => session.id === sessionId,
          );
          const recovered = previous
            ? editedResend.recoverAfterFailure(previous)
            : undefined;
          flushSync(() => {
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && recovered ? recovered : session,
              ),
            );
          });
        };

        const checkpointTurnId =
          !current.inboxAsk && !orchestrator.forSession(sessionId)
            ? await beginSessionTurn(
                sessionId,
                workCwd,
                sessionEditPaths(current.blocks),
                checkpointId,
              )
            : undefined;
        if (turnGen.current.get(sessionId) !== gen) {
          if (checkpointTurnId) {
            await finishSessionTurn(sessionId, workCwd, {
              turnId: checkpointTurnId,
            });
          }
          return;
        }
        let buildSucceeded = false;
        try {
          const prepared = await prepareAttachments(attachments);
          const prompt =
            intent === "build" && approvedPlan
              ? buildPlanPrompt(approvedPlan.text)
              : await preparePrompt(harnessText, {
                  harness: current.harness,
                  sessionId,
                  cwd: workCwd,
                });
          const turnPrompt = proposalDraft
            ? options?.orchestrationRetry?.response
              ? orchestrationRepairPrompt({
                  ...proposalDraft,
                  error: options.orchestrationRetry.error,
                  response: options.orchestrationRetry.response,
                })
              : orchestrationPlanningPrompt(
                  prompt,
                  proposalDraft.settings,
                  proposalDraft.checkoutCwd ?? proposalDraft.cwd,
                )
            : intent === "plan" && !rawCommand
              ? planTurnPrompt(prompt)
              : prompt;
          const earlier = queuedHandoff
            ? userMessagesAfterHandoff(current)
            : [];
          if (editedResend && canRewindHarnessLastTurn(current.harness)) {
            try {
              await rewindHarnessLastTurn({
                harness: current.harness,
                nativeSession: current.nativeSession,
                sessionId,
                cwd: workCwd,
                model: current.model,
                modelSettings: current.modelSettings,
                runtimeMode: current.runtimeMode,
                ...(editedProviderTurnId
                  ? { providerTurnId: editedProviderTurnId }
                  : {}),
                onEvent: (event) => {
                  if (turnGen.current.get(sessionId) !== gen) return;
                  enqueueHarnessEvent(sessionId, event);
                },
              });
            } catch (error) {
              flushHarnessEvents();
              editedResend.reject();
              throw error;
            }
            editedResend.markProviderRewound();
            flushHarnessEvents();
            if (turnGen.current.get(sessionId) !== gen) {
              const latest = sessionsRef.current.find(
                (session) => session.id === sessionId,
              );
              if (
                !latest ||
                (!latest.busy &&
                  latest.providerSessionId === current.providerSessionId)
              ) {
                await forgetHarnessSession(current.harness, sessionId);
                if (latest) {
                  setSessions((prev) =>
                    prev.map((session) =>
                      session.id === sessionId &&
                      session.providerSessionId === current.providerSessionId
                        ? { ...session, providerSessionId: undefined }
                        : session,
                    ),
                  );
                }
              }
              recoverEditedResend();
              return;
            }
          }
          const sendTurn = (text: string, turnAttachments = prepared) =>
            sendHarnessTurn({
              harness: current.harness,
              nativeSession: current.nativeSession,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              providerAccountId,
              runtimeMode: current.runtimeMode,
              intent: intent === "orchestrate" ? "plan" : intent,
              // A /operator user turn enables app access for this thread;
              // orchestration leads retain their separate control access.
              controlsAgents:
                operatorAccess ||
                orchestrator.run(sessionId)?.status === "active",
              appAccess: operatorAccess,
              text,
              attachments: turnAttachments,
              ...(editedResend ? { onAccepted: acceptEditedResend } : {}),
              onEvent: routeTurnEvent,
            });
          let sendText = orchestrator.prompt(
            sessionId,
            inboxAskPrompt(
              rawCommand ? undefined : current.inboxAsk,
              wrap && !rawCommand
                ? wrapHandoffPrompt(
                    wrap.text,
                    wrap.from,
                    turnPrompt.trim() || CONTINUE_PROMPT,
                    earlier,
                  )
                : turnPrompt,
            ),
          );
          if (operatorCommand.matched) {
            const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
            sendText += `\n\n<omnicode_app>\nThe user's Operator command enables app access in this thread, including later turns without the command. You can start session tabs or split session panes right or down, list and create project worktrees, choose a new session's checkout, read and continue other project sessions, save unsent drafts, organize session folders, and read or write saved notes through its local CLI. Run \`${cli} --help\` for exact commands and JSON fields, then use it as needed for the user's request. When reading another session, start with its latest two or three user/assistant exchanges. Request older exchanges with nextBefore or a larger excerpt only if needed. The CLI uses a session credential already in your environment; never print it. New sessions inherit this session's permission mode unless runtimeMode is set explicitly. For a new session with a draft, call sessions.start with its prompt and draft:true; do not submit a seed prompt. The returned ID can be used as besideSessionId to split its pane again or moved into a folder immediately. A normal sessions.start submits its prompt but returns after acceptance, so do not wait for that agent to finish before organizing it.\n</omnicode_app>`;
          }
          await sendTurn(sendText);
          acceptEditedResend();
          if (proposalDraft && !providerFailureSeen) {
            completedProposal = await completeOrRepairOrchestrationProposal(
              proposalDraft,
              nativeProposalText || proposalText,
              async (repairPrompt) => {
                proposalText = "";
                nativeProposalText = "";
                await sendTurn(repairPrompt, []);
                if (providerFailureSeen)
                  throw new Error(
                    controlOutcome.error ??
                      "The lead could not repair the proposal.",
                  );
                return nativeProposalText || proposalText;
              },
              () =>
                turnGen.current.get(sessionId) === gen &&
                !isProviderFailureText(nativeProposalText || proposalText),
            );
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                const ready = isPreparingHandoff(s)
                  ? completeHandoff(s, wrap.text)
                  : s;
                // A command owns its arguments; deliver the recap with the next chat prompt.
                return rawCommand ? ready : consumeHandoff(ready);
              }),
            );
          }
          buildSucceeded = true;
        } catch (error: unknown) {
          recoverEditedResend();
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) revealHandoff(wrap.text);
          const message =
            error instanceof Error
              ? error.message
              : String(error) || `${current.harness} adapter failed`;
          controlOutcome.error = message;
          if (!providerFailureSeen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
          }
          providerFailureSeen = true;
        } finally {
          // A failed provider can leave its process writing after the event
          // stream ends. Stop it before recording the final workspace state.
          if (providerFailureSeen && turnGen.current.get(sessionId) === gen) {
            await stopHarnessSession(current.harness, sessionId).catch(
              () => undefined,
            );
          }
          if (checkpointTurnId) {
            await finishSessionTurn(sessionId, workCwd, {
              turnId: checkpointTurnId,
            });
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          controlOutcome = {
            status:
              providerFailureSeen ||
              isProviderFailureText(controlText) ||
              !buildSucceeded
                ? "failed"
                : "completed",
            text: controlText.trim(),
            ...(providerFailureSeen ? { error: controlOutcome.error } : {}),
          };
          await flushSessionCheckpoint(sessionId);
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const stopped = stopStreaming(s);
              const providerFailed =
                providerFailureSeen ||
                isProviderFailureText(lastAssistantTextInTurn(stopped));
              const finalized =
                proposalDraft && proposalId
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      completedProposal && !providerFailed && buildSucceeded
                        ? completedProposal
                        : completeOrchestrationProposal(
                            proposalDraft,
                            nativeProposalText || proposalText,
                            providerFailed || !buildSucceeded
                              ? (controlOutcome.error ??
                                  "The lead could not finish planning.")
                              : undefined,
                          ),
                    )
                  : intent === "plan" && !nativePlanSeen && !providerFailed
                    ? promoteLastAssistantToPlan(stopped, planEventKey)
                    : stopped;
              return approvedPlan && intent === "build"
                ? withPlanStatus(
                    finalized,
                    approvedPlan.id,
                    buildSucceeded && !providerFailed ? "built" : "ready",
                  )
                : finalized;
            }),
          );
          // Next tick: the flush above has rendered by then, so the banner
          // quotes the reply's final text rather than the previous batch.
          window.setTimeout(() => {
            const finished = sessionsRef.current.find(
              (s) => s.id === sessionId,
            );
            const visible = sessionId === activeSessionIdRef.current;
            if (finished) void announceSessionFinished(finished, visible);
          }, 0);
          notifyReviewChanged(sessionId);
          notifyGitChanged();
          nudgeWorkspace(workCwd);
          nudgeWatchedFiles();
          window.setTimeout(() => nudgeWatchedFiles(), 150);
        }
      })()
        .catch((error: unknown) => {
          controlOutcome = {
            status: "failed",
            text: controlText,
            error: error instanceof Error ? error.message : String(error),
          };
          if (turnGen.current.get(sessionId) === gen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message: controlOutcome.error!,
            });
            flushHarnessEvents();
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== sessionId) return session;
                const stopped = {
                  ...stopStreaming(session),
                  worktreePreparing: undefined,
                  worktreeCreation:
                    session.worktreeCreation?.status === "creating"
                      ? failWorktreeCreation(
                          session.worktreeCreation,
                          session.worktreeCreation.id,
                          controlOutcome.error ?? "",
                        )
                      : session.worktreeCreation,
                };
                return proposalId && proposalDraft
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      completeOrchestrationProposal(
                        proposalDraft,
                        "",
                        controlOutcome.error,
                      ),
                    )
                  : stopped;
              }),
            );
          }
        })
        .finally(() => {
          titleCoordinator.current!.settled(
            sessionId,
            turnGen.current.get(sessionId) !== gen ||
              controlOutcome.status === "cancelled",
          );
          editedResend?.reject();
          if (editedResend) editedResends.finish(sessionId);
          options?.onSettled?.(
            turnGen.current.get(sessionId) !== gen
              ? { status: "cancelled", text: controlText }
              : controlOutcome,
          );
        });
      return true;
    },
    [
      applyProjectLocationChange,
      dismissNoticesForContinuedSession,
      enqueueHarnessEvent,
      flushHarnessEvents,
      sessionData,
    ],
  );

  submitAfterProjectSyncRef.current = submitSession;

  // Interactive callers use the immediate result to clear their composer. The
  // queued-launch receiver uses submitSession to await the actual acceptance.
  const onSubmit = useCallback(
    (...args: Parameters<Submit>): boolean => {
      // Reject before async preparation can make the composer clear its draft.
      if (navigation.isSwitching(args[0])) return false;
      const questionAnswer = args[3]?.questionAnswer;
      if (questionAnswer) {
        const session = sessionsRef.current.find(
          (entry) => entry.id === args[0],
        );
        if (!session) return false;
        args[1] = questionFollowUp(session, questionAnswer);
        args[3] = { ...args[3], followUpBehavior: "steer" };
      }
      const recordAccepted = (accepted: boolean) => {
        if (accepted && questionAnswer)
          setSessions((sessions) =>
            sessions.map((session) =>
              session.id === args[0]
                ? recordQuestionAnswer(session, questionAnswer)
                : session,
            ),
          );
        return accepted;
      };
      const result = submitSession(...args);
      if (typeof result === "boolean") return recordAccepted(result);
      // Deferred errors have already been displayed by submitAfterProjectSync.
      void result.then(recordAccepted).catch(() => undefined);
      return true;
    },
    [submitSession],
  );
  return { submitSession, onSubmit };
}
