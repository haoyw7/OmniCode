import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { executionWarningText } from "../integrations/harness/core/executionWarnings";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QuestionForm } from "../features/sessions/ui/QuestionForm";
import { QuestionHistoryForm } from "../features/sessions/ui/QuestionHistoryForm";
import { AgentMarkdown } from "../features/sessions/ui/AgentMarkdown";
import { PlanActions, PlanDecision } from "../features/sessions/ui/PlanPreview";
import { questionFollowUp } from "../features/sessions/model/questionHistory";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import { motion } from "motion/react";
import { popTransition, immediateTransition, msgTransition, motionDistance } from "../shared/motion/tokens";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import type { Block } from "../features/sessions/model/session";
import type { WorktreeCreation } from "../features/source-control/model/worktreeCreation";
import { buildActivityPhases, groupTurnItems, groupTurns, isSubagentBlock, isToolBlock, toolCallState } from "../features/sessions/model/transcriptActivity";
import type { QuestionAnswer } from "../features/sessions/model/userQuestion";
import type { ApprovalDecision } from "../integrations/harness";
import type { EditorNavigation } from "../features/search/model/search";
import type {
  HostSession,
  HostCommand,
} from "../features/connections/model/protocol";
import {
  mobileTranscriptPlatform,
  createMobileTranscriptPlatform,
} from "./transcriptPlatform";
import { MobileSheet } from "./MobileSheet";
import { MobileSessionProgress } from "./MobileSessionProgress";
import type { MobileGitSource } from "./mobileGit";
import type { MobileSessionChangesSource } from "./mobileSessionChanges";
import { useMobileGitIndex } from "./useMobileGitIndex";
import { buildSessionStatusPanelModel } from "../features/sessions/model/sessionStatusPanel";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { useStableCallback } from "./useStableCallback";
import { lazyMobileSheet } from "./mobileLazy";
import { MobileConversation } from "./MobileConversation";
import { AssistantStatus } from "../shared/ui/messaging/AssistantStatus";

const MobileAgentSheet = lazyMobileSheet(async () => ({ default: (await import("./MobileAgentSheet")).MobileAgentSheet }));
const MobileToolSheet = lazyMobileSheet(async () => ({ default: (await import("./MobileToolSheet")).MobileToolSheet }));
const MobileActivitySheet = lazyMobileSheet(async () => ({ default: (await import("./MobileActivitySheet")).MobileActivitySheet }));
const MobileFileSheet = lazyMobileSheet(async () => ({ default: (await import("./MobileFileSheet")).MobileFileSheet }));
const MobileGitReviewSheet = lazyMobileSheet(async () => ({ default: (await import("./MobileGitReviewSheet")).MobileGitReviewSheet }));

type FileDetail = {
  kind: "file";
  path: string;
  line?: number;
  from?: Block;
  fromActivity?: Block[];
  fromPlan?: Extract<Detail, { kind: "plan" }>;
  previous?: FileDetail;
};
type Detail =
  | { kind: "progress" }
  | { kind: "changes"; path?: string; from?: Extract<Detail, { kind: "tool" }>;
      /** The conversation's own edits rather than every uncommitted change. */
      session?: boolean }
  | { kind: "agent"; blockId: string; fromActivity?: Block[]; fromProgress?: boolean }
  | { kind: "question"; blockId: string }
  | { kind: "plan"; blockId: string; fromProgress?: boolean }
  | { kind: "activity"; steps: Block[] }
  | { kind: "tool"; block: Block; fromActivity?: Block[] }
  | FileDetail;
type Details = {
  active?: Detail["kind"];
  agent?: Extract<Detail, { kind: "agent" }>;
  activity?: Extract<Detail, { kind: "activity" }>;
  tool?: Extract<Detail, { kind: "tool" }>;
  file?: Extract<Detail, { kind: "file" }>;
  question?: Extract<Detail, { kind: "question" }>;
  plan?: Extract<Detail, { kind: "plan" }>;
  changes?: Extract<Detail, { kind: "changes" }>;
};

/** Host snapshots feed the same message renderer used by desktop sessions.
 * Memoized: typing in the composer re-renders the app, and the transcript
 * only needs to follow its snapshot. */
export const MobileTranscript = memo(function MobileTranscript({
  snapshot,
  historyEntries,
  disabled,
  onCommand,
  readBinaryFile,
  resolveNoteImage,
  animateFrom,
  active = true,
  onOverlayChange,
  gitSource,
  sessionChangesSource,
  gitEnabled = true,
  progressDock,
  questionOpen = true,
  onQuestionOpenChange,
  planDecision,
  worktreeCreation,
}: {
  snapshot: HostSession;
  /** History restored after the cached conversation first painted. */
  historyEntries?: readonly { id: string; text: string }[];
  disabled: boolean;
  onCommand: (command: HostCommand) => void | Promise<boolean>;
  readBinaryFile?: (path: string) => Promise<Uint8Array>;
  resolveNoteImage?: (asset: string) => Promise<string>;
  animateFrom?: string;
  active?: boolean;
  /** Let the native Back button dismiss a transcript sheet before leaving chat. */
  onOverlayChange?: (close?: () => void) => void;
  gitSource?: MobileGitSource;
  /** Keep/Undo review of this conversation's captured edits, when the Host has it. */
  sessionChangesSource?: MobileSessionChangesSource;
  gitEnabled?: boolean;
  /** Composer slot that hosts the session progress capsule. */
  progressDock?: HTMLElement | null;
  /** Whether the pending question's answer panel is expanded. */
  questionOpen?: boolean;
  /** Collapse the panel to read the conversation, or reopen it from its card. */
  onQuestionOpenChange?: (open: boolean) => void;
  /** The finished plan awaiting implement, revise or skip, docked like a question. */
  planDecision?: {
    blockId: string;
    open: boolean;
    onImplement: () => boolean | void;
    onRevise: (feedback: string) => boolean | void;
    onSkip: () => void;
  };
  /** The worktree a new conversation's first send is creating. */
  worktreeCreation?: WorktreeCreation;
}) {
  const { t } = useTranslation();
  const parentVisible = useSurfaceVisibility();
  const visible = active && parentVisible;
  const [detail, setDetail] = useState<Details>({});
  useEffect(() => {
    if (!visible) setDetail({});
  }, [visible]);
  const revealPendingQuestion = useStableCallback((blockId: string) => {
    if (!onQuestionOpenChange || blockId !== snapshot.session.pendingQuestion?.historyId) return false;
    onQuestionOpenChange(true);
    return true;
  });
  // Sheets portal to the app root: as a sibling of the composer dock they
  // would pick up the dock spacing rules and stop short of the screen bottom.
  const [sheetHost, setSheetHost] = useState<HTMLElement | null>(null);
  const findSheetHost = useCallback(
    (element: HTMLElement | null) =>
      setSheetHost(element?.closest<HTMLElement>(".mobile-app") ?? null),
    [],
  );
  const platform = useMemo(
    () => ({
      ...(readBinaryFile
        ? createMobileTranscriptPlatform(readBinaryFile)
        : mobileTranscriptPlatform),
      resolveNoteImage,
      openAgent: (block: Block) => setDetail((current) => ({
        ...current, active: "agent", agent: { kind: "agent", blockId: block.id },
      })),
      openTool: (block: Block) => setDetail((current) => ({
        ...current, active: "tool", tool: { kind: "tool", block },
      })),
      openActivity: (steps: Block[]) => setDetail((current) => ({
        ...current, active: "activity", activity: { kind: "activity", steps }, tool: undefined,
      })),
      openQuestion: (blockId: string) => {
        // The pending question's card reopens its panel rather than a sheet.
        if (revealPendingQuestion(blockId)) return;
        setDetail((current) => ({
          ...current, active: "question", question: { kind: "question", blockId },
        }));
      },
      openPlan: (blockId: string) => setDetail((current) => ({
        ...current, active: "plan", plan: { kind: "plan", blockId },
      })),
      liveClockInFooter: true,
    }),
    [readBinaryFile, resolveNoteImage, revealPendingQuestion],
  );
  // Phones have no editor pane, so file links open a read-only sheet.
  const openFile = useCallback(
    (path: string, navigation?: EditorNavigation) =>
      setDetail((current) => ({
        ...current,
        active: "file",
        file: {
          kind: "file", path, line: navigation?.line,
          from: current.active === "tool" ? current.tool?.block : undefined,
          fromActivity: current.active === "tool" ? current.tool?.fromActivity : undefined,
          fromPlan: current.active === "plan" ? current.plan : undefined,
          previous: current.active === "file" ? current.file : undefined,
        },
      })),
    [],
  );
  const { session, runId } = snapshot;
  const activitySteps = useMemo(() => {
    const opened = detail.activity?.steps;
    if (!opened) return [];
    const selected = new Set(opened.map((step) => step.id));
    // Resolve the opened groups against each snapshot so newly arriving calls
    // appear too. Group boundaries keep later work and other turns out.
    const turn = groupTurns(session.blocks).find((blocks) =>
      blocks.some((block) => selected.has(block.id)));
    if (!turn) return opened;
    for (const item of groupTurnItems(turn)) {
      if (item.type !== "activity") continue;
      for (const phase of buildActivityPhases(item.blocks)) {
        if (phase.steps.some((step) => selected.has(step.id)))
          for (const step of phase.steps) selected.add(step.id);
      }
    }
    return turn.filter((block) => selected.has(block.id));
  }, [session.blocks, detail.activity?.steps]);
  // A sent message waits in a typing bubble until the agent's first output.
  const lastBlock = session.blocks.at(-1);
  const awaitingReply = lastBlock?.role === "user" && !lastBlock.draft &&
    (!!lastBlock.sending || snapshot.status === "running");
  const git = useMobileGitIndex(gitSource, visible && gitEnabled, snapshot.status === "running");
  const sessionChanges = useMobileGitIndex(sessionChangesSource, visible && gitEnabled, snapshot.status === "running");
  const sessionChangeActions = useMemo(() => sessionChangesSource ? {
    busy: snapshot.status === "running",
    keep: sessionChangesSource.keep,
    undo: () => sessionChangesSource.undo().finally(git.refresh),
  } : undefined, [sessionChangesSource, snapshot.status, git.refresh]);
  const openDiff = useCallback((path: string) => {
    git.refresh();
    setDetail((current) => ({
      ...current,
      active: "changes",
      changes: {
        kind: "changes", path,
        from: current.active === "tool" ? current.tool : undefined,
      },
    }));
  }, [git.refresh]);
  const statusGit = useMemo(() => git.index ? {
    additions: git.index.additions, deletions: git.index.deletions,
    branch: git.index.branch ?? undefined, files: git.index.files.length,
  } : null, [git.index]);
  const progress = useMemo(() => buildSessionStatusPanelModel({
    blocks: session.blocks,
    backgroundTasks: session.backgroundTasks,
    busy: snapshot.status === "running",
    git: statusGit,
  }), [session.blocks, session.backgroundTasks, snapshot.status, statusGit]);
  useEffect(() => {
    setDetail((current) => current.active === "changes" ? { ...current, active: "progress", changes: undefined } : current);
  }, [gitSource]);
  useEffect(() => {
    if (!progress.hasContent && !gitSource) setDetail((current) =>
      current.active === "progress" ? { ...current, active: undefined } : current);
  }, [progress.hasContent, gitSource]);
  const questionShown = !!session.pendingQuestion && questionOpen;
  const reduced = useMotionPreference();
  const questionMotion = useCollapseMotion(questionShown);
  const planShown = !!planDecision?.open && visible;
  const planMotion = useCollapseMotion(planShown);
  // Keep a decision that was answered or skipped mounted while it folds away.
  const lastPlanDecision = useRef(planDecision);
  if (planDecision) lastPlanDecision.current = planDecision;
  const dockedPlan = planDecision ??
    (planMotion.foldState === "closed" ? undefined : lastPlanDecision.current);
  const sessionId = session.id;
  const questionBlockId = detail.question?.blockId;
  const savedQuestion = detail.question
    ? session.blocks.find((block) => block.id === detail.question!.blockId)?.question
    : undefined;
  const canAnswerSavedQuestion = !!savedQuestion?.allowLateReply && !savedQuestion.reply &&
    savedQuestion.decision !== "answered" && session.pendingQuestion?.historyId !== detail.question?.blockId;
  const workflowParent = useMemo(() => session.blocks.some((block) => block.workflowRun)
    ? { id: session.id, harness: session.harness, model: session.model, modelSettings: session.modelSettings,
      workflowRuns: session.workflowRuns, cwd: session.cwd } : undefined,
  [session.id, session.blocks, session.harness, session.model, session.modelSettings, session.workflowRuns, session.cwd]);
  const onQuestionFollowUp = useStableCallback((answer: QuestionAnswer) =>
    disabled || !visible ? false : onCommand({ type: "send", commandId: crypto.randomUUID(), sessionId,
      text: questionFollowUp(session, answer), followUpBehavior: "steer", questionAnswer: answer }));
  const planBlock = detail.plan
    ? session.blocks.find((block) => block.id === detail.plan!.blockId && block.role === "plan")
    : undefined;
  const releasePlan = useCallback(() => setDetail((current) =>
    current.active === "plan" ? current : { ...current, plan: undefined }), []);
  const closeDetail = useCallback(() => setDetail((current) => ({ ...current, active: undefined })), []);
  const backProgress = useCallback(() => setDetail((current) => ({ ...current, active: "progress" })), []);
  const backFile = useCallback(() => setDetail((current) => {
    const file = current.file;
    if (file?.previous) return { ...current, active: "file", file: file.previous };
    if (file?.fromPlan) return { ...current, active: "plan", plan: file.fromPlan };
    if (file?.from) return {
      ...current, active: "tool", tool: { kind: "tool", block: file.from, fromActivity: file.fromActivity },
      activity: file.fromActivity ? { kind: "activity", steps: file.fromActivity } : current.activity,
    };
    return { ...current, active: undefined };
  }), []);
  const backChanges = useCallback(() => setDetail((current) => {
    const from = current.changes?.from;
    return {
      ...current,
      active: current.changes?.path ? from?.kind : "progress",
      tool: from ?? current.tool,
      activity: from?.fromActivity ? { kind: "activity", steps: from.fromActivity } : current.activity,
    };
  }), []);
  const releaseChanges = useCallback(() => setDetail((current) => current.active === "changes" ? current : { ...current, changes: undefined }), []);
  useEffect(() => {
    onOverlayChange?.(visible && detail.active ? detail.active === "changes" ? backChanges : closeDetail : undefined);
    return () => onOverlayChange?.(undefined);
  }, [visible, detail.active, backChanges, closeDetail, onOverlayChange]);
  const releaseActivity = useCallback(() => setDetail((current) =>
    current.active === "activity" || (current.active === "agent" && current.agent?.fromActivity) || (current.active === "tool" && current.tool?.fromActivity)
      ? current : { ...current, activity: undefined,
        tool: current.tool?.fromActivity ? undefined : current.tool }), []);
  const openStep = useCallback((block: Block) => setDetail((current) => isSubagentBlock(block) ? ({
    ...current, active: "agent", agent: { kind: "agent", blockId: block.id, fromActivity: current.activity?.steps },
  }) : ({ ...current, active: "tool", tool: { kind: "tool", block, fromActivity: current.activity?.steps } })), []);
  const releaseAgent = useCallback(() => setDetail((current) =>
    current.active === "agent" ? current : { ...current, agent: undefined }), []);
  const releaseTool = useCallback(() => setDetail((current) =>
    current.active === "tool" ? current : { ...current, tool: undefined }), []);
  const releaseFile = useCallback(() => setDetail((current) =>
    current.active === "file" ? current : { ...current, file: undefined }), []);
  const releaseQuestion = useCallback(() => setDetail((current) =>
    current.active === "question" && canAnswerSavedQuestion ? current : {
      ...current, question: undefined,
      active: current.active === "question" ? undefined : current.active,
    }), [canAnswerSavedQuestion]);
  const closeQuestion = useCallback(() => setDetail((current) =>
    current.active === "question" && current.question?.blockId === questionBlockId
      ? { ...current, active: undefined } : current), [questionBlockId]);
  // Memoized transcript blocks compare this callback; a fresh one on every
  // poll would re-render each block while a reply streams.
  const onApproval = useMemo(
    () =>
      !disabled && visible && runId
        ? (requestId: number, decision: ApprovalDecision) =>
            onCommand({
              type: "approve",
              commandId: crypto.randomUUID(),
              sessionId,
              runId,
              requestId,
              decision,
            })
        : undefined,
    [disabled, visible, runId, sessionId, onCommand],
  );
  return (
    <TranscriptPlatformContext.Provider value={platform}>
      <MobileSessionProgress model={progress} visible={visible} open={detail.active === "progress"}
        sheetHost={sheetHost}
        dock={progressDock}
        review={gitSource ? git : undefined}
        onReview={() => {
          git.refresh();
          setDetail((current) => ({ ...current, active: "changes", changes: { kind: "changes" } }));
        }}
        sessionReview={sessionChanges.index?.files.length ? sessionChanges : undefined}
        onSessionReview={() => {
          sessionChanges.refresh();
          setDetail((current) => ({ ...current, active: "changes", changes: { kind: "changes", session: true } }));
        }}
        onOpen={() => setDetail((current) => ({ ...current, active: "progress" }))}
        onClose={closeDetail}
        onNavigate={(kind, blockId) => setDetail((current) => ({
          ...current, active: kind, [kind]: { kind, blockId, fromProgress: true },
        }))} />
      <MobileConversation
        notice={snapshot.executionWarnings?.length ? <div className="mobile-execution-notice" role="status">
          {snapshot.executionWarnings.map((warning, index) => <p key={`${index}:${warning}`}>{executionWarningText(warning, t)}</p>)}
        </div> : undefined}
        containerRef={findSheetHost}
        active={visible}
        hapticsActive={visible && !disabled && !detail.active}
        hapticsScope={`${session.id}:${runId}`}
        hapticsAttention={session.pendingQuestion ? `question:${session.pendingQuestion.requestId}` : session.blocks.filter((block) => block.role === "approval" && block.approval && !block.approval.decided).at(-1)?.id}
        hapticsCompleted={snapshot.status === "idle"}
        progress={!progressDock && visible && (progress.hasContent || !!git.error || (detail.active === "progress" && !!gitSource))}
        clockOffsetMs={snapshot.clockOffsetMs}
        // The drawer and overlays only cover the transcript. Treating that
        // as hidden would fold live work behind them and unfold it after.
        visible={parentVisible}
        animateFrom={animateFrom}
        blocks={session.blocks}
        executionState={session.executionState}
        historyEntries={historyEntries}
        busy={snapshot.status === "running"}
        cwd={session.cwd}
        harness={session.harness}
        model={session.model}
        modelSettings={session.modelSettings}
        workflowParent={workflowParent}
        pendingQuestion={!!session.pendingQuestion}
        pendingQuestionHistoryId={session.pendingQuestion?.historyId}
        onQuestionFollowUp={session.harness !== "codex" ? undefined : onQuestionFollowUp}
        onOpenFile={readBinaryFile ? openFile : undefined}
        onOpenDiff={gitSource ? openDiff : readBinaryFile ? openFile : undefined}
        onApproval={onApproval}
        decidingPlanId={planDecision?.blockId}
        worktreeCreation={worktreeCreation}
        latestTurnAccessory={awaitingReply ? (
          <motion.div initial={reduced ? false : { opacity: 0, y: motionDistance.msg }} animate={{ opacity: 1, y: 0 }} transition={reduced ? immediateTransition : msgTransition} className="mobile-typing-bubble">
            <AssistantStatus icon={<HarnessIcon harness={session.harness} />} role="status"><span className="transcript-live-status">{t("Waiting for a reply")}</span></AssistantStatus>
          </motion.div>
        ) : undefined}
      />
      {session.pendingQuestion && (
        <motion.div
          initial={false}
          animate={{ gridTemplateRows: questionShown ? "1fr" : "0fr" }}
          transition={reduced ? immediateTransition : popTransition}
          onAnimationComplete={questionMotion.finish}
          className="mobile-shared-question-dock animated-collapse-size"
          data-open={questionShown}
          data-fold-state={questionMotion.foldState}
          aria-hidden={!questionShown || undefined}
          inert={!questionShown || undefined}
        >
          {/* Collapsing keeps the form mounted, so partial answers survive. */}
          <div className="mobile-shared-question-clip">
            <fieldset
              className="mobile-shared-question"
              disabled={!visible || disabled || !runId}
            >
              <QuestionForm
                key={`${runId}:${session.pendingQuestion.requestId}`}
                prompt={session.pendingQuestion}
                onCollapse={onQuestionOpenChange ? () => onQuestionOpenChange(false) : undefined}
                onReply={(requestId, reply) => {
                  if (!disabled && runId)
                    onCommand({
                      type: "answer",
                      commandId: crypto.randomUUID(),
                      sessionId: session.id,
                      runId,
                      requestId,
                      reply,
                    });
                }}
              />
            </fieldset>
          </div>
        </motion.div>
      )}
      {dockedPlan && !session.pendingQuestion && (
        <motion.div
          initial={false}
          animate={{ gridTemplateRows: planShown ? "1fr" : "0fr" }}
          transition={reduced ? immediateTransition : popTransition}
          onAnimationComplete={planMotion.finish}
          className="mobile-shared-question-dock animated-collapse-size"
          data-open={planShown}
          data-fold-state={planMotion.foldState}
          aria-hidden={!planShown || undefined}
          inert={!planShown || undefined}
        >
          <div className="mobile-shared-question-clip">
            <fieldset className="mobile-shared-question" disabled={!planShown || disabled}>
              <PlanDecision
                key={dockedPlan.blockId}
                onImplement={dockedPlan.onImplement}
                onRevise={dockedPlan.onRevise}
                onSkip={dockedPlan.onSkip}
              />
            </fieldset>
          </div>
        </motion.div>
      )}
      {sheetHost &&
        createPortal(
          <>
            {detail.changes?.session && sessionChangesSource ? <MobileGitReviewSheet
              open={visible && detail.active === "changes"} onExited={releaseChanges}
              source={sessionChangesSource} state={sessionChanges} enabled={gitEnabled}
              session={sessionChangeActions}
              onBack={backChanges} onClose={closeDetail} />
            : detail.changes && gitSource && <MobileGitReviewSheet
              open={visible && detail.active === "changes"} onExited={releaseChanges}
              source={gitSource} state={git} enabled={gitEnabled}
              path={detail.changes.path} cwd={session.cwd}
              onBack={!detail.changes.path || detail.changes.from ? backChanges : undefined} onClose={closeDetail} />}
            {detail.question && savedQuestion && (
              <MobileSheet
                open={visible && detail.active === "question" && canAnswerSavedQuestion}
                onExited={releaseQuestion}
                title="Answer question"
                header={{ title: t("Answer question") }}
                onClose={closeQuestion}
              >
                <QuestionHistoryForm
                  key={detail.question.blockId}
                  blockId={detail.question.blockId}
                  question={savedQuestion}
                  disabled={disabled || !canAnswerSavedQuestion}
                  onAnswer={onQuestionFollowUp}
                  onClose={closeQuestion}
                />
              </MobileSheet>
            )}
            {detail.plan && planBlock && (
              <MobileSheet
                open={visible && detail.active === "plan"}
                onExited={releasePlan}
                title="Plan"
                header={{ title: t("Plan") }}
                onBack={detail.plan.fromProgress ? backProgress : undefined}
                onClose={closeDetail}
              >
                <div className="mobile-plan-sheet">
                  <div className="mobile-plan-sheet-actions">
                    <PlanActions text={planBlock.text} />
                  </div>
                  <AgentMarkdown text={planBlock.text} streaming={planBlock.streaming}
                    cwd={session.cwd} onOpenFile={readBinaryFile ? openFile : undefined} />
                </div>
              </MobileSheet>
            )}
            {detail.agent && !detail.agent.fromActivity && <MobileAgentSheet key={detail.agent.blockId} open={visible && detail.active === "agent"}
              onExited={releaseAgent} blocks={session.blocks} blockId={detail.agent.blockId}
              cwd={session.cwd} readBinaryFile={readBinaryFile} onClose={closeDetail}
              onBack={detail.agent.fromProgress ? backProgress : undefined} />}
            {detail.activity && (
              <MobileActivitySheet
                open={visible && (detail.active === "activity" ||
                  (detail.active === "agent" && !!detail.agent?.fromActivity) ||
                  (detail.active === "tool" && !!detail.tool?.fromActivity))}
                onExited={releaseActivity}
                // Follow live blocks so a running group fills in while open.
                steps={activitySteps}
                cwd={session.cwd}
                live={snapshot.status === "running" &&
                  activitySteps.some((step) => isToolBlock(step) && toolCallState(step) === "pending")}
                onStep={openStep}
                sessionBlocks={session.blocks}
                readBinaryFile={readBinaryFile}
                selectedAgent={detail.active === "agent" && detail.agent?.fromActivity
                  ? session.blocks.find((block) => block.id === detail.agent!.blockId) : undefined}
                selectedStep={detail.tool?.fromActivity
                  ? session.blocks.find((block) => block.id === detail.tool!.block.id) ?? detail.tool.block
                  : undefined}
                onBack={() => setDetail((current) => ({ ...current, active: "activity", tool: undefined, agent: undefined }))}
                onOpenFile={readBinaryFile ? openFile : undefined}
                onClose={closeDetail}
              />
            )}
            {detail.tool && !detail.tool.fromActivity && (
              <MobileToolSheet
                open={visible && detail.active === "tool"}
                onExited={releaseTool}
                // Follow the live block so a running call fills in while open.
                block={
                  session.blocks.find(
                    (block) => block.id === detail.tool!.block.id,
                  ) ?? detail.tool.block
                }
                cwd={session.cwd}
                onOpenFile={readBinaryFile ? openFile : undefined}
                onClose={closeDetail}
              />
            )}
            {detail.file && readBinaryFile && (
              <MobileFileSheet
                open={visible && detail.active === "file"}
                onExited={releaseFile}
                path={detail.file.path}
                line={detail.file.line}
                cwd={session.cwd}
                readBinaryFile={readBinaryFile}
                onOpenFile={openFile}
                onBack={
                  detail.file.from || detail.file.fromPlan || detail.file.previous ? backFile : undefined
                }
                onClose={closeDetail}
              />
            )}
          </>,
          sheetHost,
        )}
    </TranscriptPlatformContext.Provider>
  );
});
