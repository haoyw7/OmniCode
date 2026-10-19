import type { SessionExecutionState } from "../model/session";
import "./AgentTranscript.css";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import type { QuestionAnswer } from "../model/userQuestion";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import {
  memo,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { OrchestrationPreview } from "../../orchestration/ui/OrchestrationPreview";
import { WorkflowRunCard, type WorkflowRunParent } from "../../workflows/ui/WorkflowRunCard";
import { WorktreeCreationCard } from "./WorktreeCreationCard";
import {
  worktreeCreationFromRecord,
  type WorktreeCreation,
} from "../../source-control/model/worktreeCreation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";
import type { ApprovalDecision } from "../../../integrations/harness";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import {
  AfterTextReveal,
  useTranscriptRenderingPlatform,
} from "./useTranscriptRenderingPlatform";
import { TranscriptContentMotion, useMessageArrivals } from "./TranscriptContentMotion";
import { resolveModel } from "../model/models";
import { harnessForTurn } from "../model/secondOpinion";
import { TranscriptTurnCache } from "../model/transcriptTurnCache";
import { userTurnStartTimes } from "../model/turnTiming";
import {
  hasPendingApproval,
  type Block,
  type HarnessId,
  type ModelTarget,
  type PlanBuildTarget,
} from "../model/session";
import {
  useLockOverscroll,
} from "../../../shared/hooks/useLockOverscroll";
import { useTranscriptLayout } from "../hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import {
  activityStillRunning,
  firstFoldableIndex,
  foldableWork,
  foldedBlocks,
  initialThinkingIndex,
  lastActivityIndex,
  isProseBlock,
  turnCopyText,
  workDiffStats,
  workKind,
  workSummaryLine,
  type TurnItem,
} from "../model/transcriptActivity";
import { lastUserTurnBlock } from "../model/editLastTurn";
import {
  clearTranscriptHighlights,
  paintTranscriptHighlights,
  transcriptMutationNeedsRepaint,
  transcriptWordRanges,
} from "../model/transcriptHighlights";
import { confirmPrompt } from "./promptLaunch";
import { measureLastTurn, type PriorTurn, promptParts, type PromptRise, promptRow, riseIntoAnchor, syncTranscriptViewport, turnUserBlock } from "./transcript/scrollAnchor";
import { type PrependScrollAnchor, useTurnScrollAnchor } from "./transcript/useTurnScrollAnchor";
import { InitialThinking, LiveFoldTitle, LiveTurnFooter } from "./transcript/LiveTurn";
import { formatWorkingDuration, TranscriptClockOffset } from "./transcript/transcriptClock";
import { ActivityPhases, SubagentStack } from "./transcript/activity/ActivityPhases";
import { TranscriptBlock } from "./transcript/TranscriptBlock";
import { FoldingRow, turnItemKey, TurnRow, WorkFoldLine } from "./transcript/TurnRows";
import { TurnDuration } from "./transcript/TurnMetrics";
import { useTranscriptFollow } from "./transcript/useTranscriptFollow";
import { useTranscriptPaging } from "./transcript/useTranscriptPaging";
import { visibleTranscriptBlocks } from "./transcript/visibleTranscriptBlocks";

const NEAR_BOTTOM_PX = 16;

type Props = {
  clockOffsetMs?: number;
  blocks: Block[];
  /** Restored history may arrive after the cached transcript is already visible. */
  historyEntries?: readonly { id: string; text: string }[];
  busy?: boolean;
  cwd?: string;
  harness?: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  pendingQuestion?: boolean;
  pendingQuestionHistoryId?: string;
  onQuestionFollowUp?: (answer: QuestionAnswer) => boolean | void | Promise<boolean | void>;
  /** Work the agent left running when it yielded; the turn waits on it. */
  backgroundTasks?: string[];
  executionState?: SessionExecutionState;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onAddToChat?: (text: string) => void;
  onSaveNote?: (text: string) => void | Promise<void>;
  onSendDraft?: (block: Block) => boolean | void;
  onRemoveDraft?: (block: Block) => boolean | void;
  onSaveSelectionNote?: (text: string) => void | Promise<void>;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onOpenAgent?: (block: Block) => void;
  onOpenBot?: (origin: NonNullable<Block["origin"]>) => void | Promise<void>;
  onOpenQuestion?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  /** The plan whose decision panel is open; its card omits Build. */
  decidingPlanId?: string;
  planBuildTargets?: boolean;
  onSecondOpinion?: (target: ModelTarget, turn: Block[]) => void;
  onHandoff?: (target: ModelTarget, turn: Block[]) => void;
  onEditLastTurn?: () => void;
  editingLastTurn?: boolean;
  onJumpToBottomChange?: (show: boolean) => void;

  onJumpToBottomReady?: (jump: () => void) => void;
  /** Passes a function that renders the turn that holds a block. The render completes before the function returns. */
  onRevealReady?: (reveal: (blockId: string) => boolean) => void;
  onNavigateReady?: (
    navigate: (blockId: string | null, query?: string) => boolean,
  ) => void;
  /** Per-turn output shown after the reply and before its action row. */
  turnAccessory?: (user: Block | undefined, latest: boolean) => ReactNode;
  /** False while another tab is in front; local transcript state is retained. */
  visible?: boolean;
  /** Kept mounted after its pane closed. Showing it again counts as a new visit. */
  parked?: boolean;
  onScrollerChange?: (el: HTMLDivElement | null) => void;
  /** A worker's transcript: show the orchestrator's turns instead of hiding them. */
  managed?: boolean;
  /** Distinguish touch/reader scrolling from streamed layout growth. */
  touchScroll?: boolean;
  /** A just-submitted turn whose first response may already have arrived. */
  animateFrom?: string;
  /** Phone viewport changes pin immediately while the keyboard animates. */
  promptMotion?: "mobile";
  /** The conversation this transcript belongs to, for its workflow run cards. */
  workflowParent?: WorkflowRunParent;
  /** The worktree the first send created; its card sits under that message. */
  worktreeCreation?: WorktreeCreation;
};

function AgentTranscriptComponent({
  blocks: sourceBlocks,
  historyEntries,
  busy,
  cwd,
  harness,
  model,
  modelSettings,
  workflowParent,
  worktreeCreation,
  pendingQuestion = false,
  pendingQuestionHistoryId,
  onQuestionFollowUp,
  backgroundTasks,
  executionState,
  onApproval,
  onAddToChat,
  onSaveNote,
  onSendDraft,
  onRemoveDraft,
  onSaveSelectionNote,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onOpenAgent,
  onOpenBot,
  onOpenQuestion,
  onBuildPlan,
  decidingPlanId,
  planBuildTargets = true,
  onSecondOpinion,
  onHandoff,
  onEditLastTurn,
  editingLastTurn = false,
  onJumpToBottomChange,
  onJumpToBottomReady,
  onRevealReady,
  onNavigateReady,
  turnAccessory,

  visible = true,
  parked = false,
  onScrollerChange,
  managed = false,
  touchScroll = true,
  animateFrom,
  promptMotion,
}: Props) {
  const basePlatform = useTranscriptRenderingPlatform(sourceBlocks, {
    animateFrom,
    historyEntries,
  });
  const renderingPlatform = useMemo(
    () => ({
      ...basePlatform,
      ...(onOpenAgent ? { openAgent: onOpenAgent } : {}),
      ...(onOpenBot ? { openBot: onOpenBot } : {}),
      ...(onOpenQuestion ? { openQuestion: onOpenQuestion } : {}),
    }),
    [basePlatform, onOpenAgent, onOpenBot, onOpenQuestion],
  );
  const { t: uiT } = useTranslation();
  const { liveClockInFooter, openActivity, messageMotion } = useContext(TranscriptPlatformContext);
  const messageArrives = useMessageArrivals(sourceBlocks, visible, animateFrom, historyEntries);
  const clockInFooter = !!liveClockInFooter && !!cwd;
  const blocks = useMemo(
    () => visibleTranscriptBlocks(sourceBlocks, harness),
    [harness, sourceBlocks],
  );
  const turnStartTimes = useMemo(() => userTurnStartTimes(blocks), [blocks]);
  const editableUserBlockId = useMemo(
    () => lastUserTurnBlock(blocks)?.id,
    [blocks],
  );
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const prependAnchor = useRef<PrependScrollAnchor | null>(null);
  const wasVisible = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  // Turns whose folded work the reader has opened, by turn id.
  const [openWork, setOpenWork] = useState<Record<string, boolean>>({});
  // Live turns only: which rows each fold already held, and when rows joined it,
  // so rows the answer just folded close in place instead of vanishing.
  const foldHistory = useRef(
    new Map<string, { folded: Set<string>; joined: Map<string, number> }>(),
  );
  const [searchCurrent, setSearchCurrent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const highlightOwner = useRef(Symbol("transcript-search"));
  // Stretch the last turn after a send while this tab stays open. Closing
  // the tab is a new visit: the remount uses the true transcript height so
  // the latest reply sits near the composer instead of a hole of empty space.
  const [anchorTurn, setAnchorTurn] = useState(
    !!busy || !!animateFrom,
  );
  // Parking detaches the scroller, which drops its scroll offset.
  const restoreScroll = useRef(false);
  const wasParked = useRef(parked);
  if (wasParked.current !== parked) {
    wasParked.current = parked;
    if (parked) {
      restoreScroll.current = true;
      setSearchCurrent(null);
      setSearchQuery("");
    } else if (anchorTurn !== !!busy) {
      setAnchorTurn(!!busy);
    }
  }
  const { selection, dismissSelection } = useTranscriptSelection(
    scrollerEl,
    onAddToChat !== undefined || onSaveSelectionNote !== undefined,
  );
  const transcriptLayout = useTranscriptLayout();
  const promptAnchor = useTranscriptAnchor();
  const {
    stickToBottom,
    distanceFromBottom,
    wheelHold,
    setShowJump,
    syncJumpVisibility,
    rememberScroll,
    pinTranscript,
    followTranscript,
    pauseFollowing,
  } = useTranscriptFollow({
    scroller,
    transcriptEnd,
    scrollerEl,
    visible,
    touchScroll,
    promptMotion,
    historyEntries,
    onJumpToBottomChange,
    onJumpToBottomReady,
  });
  const toggleWork = useCallback((turnId: string, currentlyOpen: boolean) => {
    pauseFollowing();
    setOpenWork((open) => ({ ...open, [turnId]: !currentlyOpen }));
  }, [pauseFollowing]);
  const lastUser = turnUserBlock(blocks, managed);
  const lastUserId = lastUser?.id;
  const lastUserSending = !!lastUser?.sending;
  const seenUserId = useRef(lastUserId);
  const seenSending = useRef(lastUserSending);
  // The prompt before a sending copy: getting it back means the send failed.
  const beforeSending = useRef<string | undefined>(undefined);
  // A sending copy is replaced by its recorded message or withdrawn; neither
  // is a new send to introduce.
  const promptChange = useRef<"sent" | "recorded" | "withdrawn">("sent");
  // Where the previous turn sat before a send moves it, read while the
  // DOM still shows the old layout so earlier turns can glide up continuously.
  const priorTurn = useRef<PriorTurn | undefined>(undefined);
  if (lastUserId !== seenUserId.current) {
    const wasSending = seenSending.current;
    promptChange.current = !wasSending
      ? "sent"
      : lastUserId === beforeSending.current
        ? "withdrawn"
        : "recorded";
    if (lastUserSending && !wasSending) beforeSending.current = seenUserId.current;
    seenUserId.current = lastUserId;
    priorTurn.current = promptChange.current === "sent"
      ? measureLastTurn(scroller.current)
      : undefined;
    if (lastUserId && !anchorTurn) setAnchorTurn(true);
  }
  seenSending.current = lastUserSending;
  const currentModelName = harness
    ? resolveModel(harness, model).name
    : undefined;
  const waitingForApproval = hasPendingApproval(blocks) || pendingQuestion;
  const preparingHandoff = blocks.some(
    (block) =>
      block.role === "handoff" && block.handoff?.status === "preparing",
  );

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      setScrollerEl(el);
      lockOverscroll(el);
    },
    [lockOverscroll],
  );

  useLayoutEffect(() => {
    onScrollerChange?.(scrollerEl);
    return () => onScrollerChange?.(null);
  }, [onScrollerChange, scrollerEl]);

  useLayoutEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinTranscript(el);
  }, [lastUserId, pinTranscript, setShowJump]);

  // Both clients slide sent prompts into their laid-out rows. A mount may be
  // an existing running session, so only an explicitly marked submission
  // introduces its prompt on mount.
  const introducePrompt = useRef({ chat: false, visible });
  introducePrompt.current = {
    chat: transcriptLayout === "chat",
    visible,
  };
  // The prompt shown at mount is history, even when StrictMode replays effects.
  const mountedPromptId = useRef(lastUserId);
  const promptRise = useRef<PromptRise | undefined>(undefined);
  useLayoutEffect(() => {
    const mounting = lastUserId === mountedPromptId.current;
    const change = promptChange.current;
    promptChange.current = "sent";
    const own = (rise: PromptRise | undefined) => () => {
      // A recorded copy takes over the running motion of its sending copy.
      if (promptChange.current === "recorded" && promptRise.current === rise) return;
      rise?.stop();
      if (promptRise.current === rise) promptRise.current = undefined;
    };
    if (
      change === "withdrawn" ||
      !introducePrompt.current.visible ||
      (!mounting && !wasVisible.current)
    )
      return;
    if (change === "recorded") {
      const rise = promptRise.current;
      if (lastUserId && rise?.follow(lastUserId)) return own(rise);
      promptRise.current = undefined;
      if (lastUserId && !reducedMotionQuery().matches)
        confirmPrompt(promptParts(promptRow(scroller.current, lastUserId)));
      return;
    }
    const { chat, visible } = introducePrompt.current;
    if (!lastUserId || !chat || !visible) return;
    if (mounting && animateFrom !== lastUserId) return;
    const prior = priorTurn.current;
    priorTurn.current = undefined;
    const rise = riseIntoAnchor(scroller.current, lastUserId, prior);
    promptRise.current = rise;
    return own(rise);
    // Only a new prompt starts the motion; later renders must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId]);

  // The Host usually records a sending message under the same id; it then
  // lifts to full strength where it is, while any slide carries on.
  const shownSending = useRef({ id: lastUserId, sending: lastUserSending });
  useLayoutEffect(() => {
    const previous = shownSending.current;
    shownSending.current = { id: lastUserId, sending: lastUserSending };
    if (
      !visible ||
      !wasVisible.current ||
      !lastUserId ||
      previous.id !== lastUserId ||
      !previous.sending ||
      lastUserSending
    )
      return;
    if (!reducedMotionQuery().matches)
      confirmPrompt(promptParts(promptRow(scroller.current, lastUserId)));
  }, [lastUserId, lastUserSending, visible]);

  useLayoutEffect(() => {
    if (!visible) promptRise.current?.stop();
  }, [visible]);

  useLayoutEffect(() => {
    const opened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opened) return;
    const el = scroller.current;
    if (!el) return;
    syncTranscriptViewport(el);
    const restore = restoreScroll.current;
    restoreScroll.current = false;
    // Previously opened tabs normally retain their scroll position. Only pin
    // when the scroller looks empty after being hidden with `display: none`.
    if (el.scrollHeight <= el.clientHeight + NEAR_BOTTOM_PX) {
      stickToBottom.current = true;
      setShowJump(false);
      pinTranscript(el);
    } else if (restore && stickToBottom.current) {
      // Reattaching can reset scrollTop. Restore the bottom pin before a
      // follow pass mistakes that reset for the reader scrolling upward.
      pinTranscript(el);
    } else if (restore) {
      el.scrollTop = Math.max(
        0,
        el.scrollHeight - el.clientHeight - distanceFromBottom.current,
      );
      rememberScroll(el);
    }
  }, [visible, pinTranscript, rememberScroll, setShowJump]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = scroller.current;
    syncTranscriptViewport(el);
    // Reconcile a pending scroll-to-end even while following was paused.
    followTranscript(el);
  }, [blocks, busy, followTranscript, visible]);

  useLayoutEffect(() => {
    const el = scrollerEl;
    const inner = el?.firstElementChild;
    if (!visible || !el || !inner) return;
    let endObserver: IntersectionObserver | undefined;
    let endMargin: string | undefined;
    let observedEnd: HTMLElement | null = null;
    const onResize = () => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      syncTranscriptViewport(el);
      // The anchored turn can grow inside its minimum height without resizing
      // the scroller or its body. Watch its actual content end as well, inset
      // above floating controls; composer resizing changes these insets.
      const style = getComputedStyle(el);
      const topInset = parseFloat(style.scrollPaddingTop) || 0;
      const bottomInset = parseFloat(style.scrollPaddingBottom) || 0;
      const margin = `-${topInset}px 0px -${bottomInset}px 0px`;
      if (
        (margin !== endMargin || transcriptEnd.current !== observedEnd) &&
        transcriptEnd.current
      ) {
        endObserver?.disconnect();
        endMargin = margin;
        observedEnd = transcriptEnd.current;
        endObserver = new IntersectionObserver(
          () => syncJumpVisibility(el),
          { root: el, rootMargin: margin },
        );
        endObserver.observe(observedEnd);
      }
      followTranscript(el);
      syncJumpVisibility(el);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(inner);
    observer.observe(el);
    onResize();
    return () => {
      observer.disconnect();
      endObserver?.disconnect();
    };
  }, [scrollerEl, followTranscript, syncJumpVisibility, visible, lastUserId]);

  // The anchor class follows state that can change without blocks or busy
  // changing; keep its stretch on whichever turn carries it now.
  useLayoutEffect(() => {
    if (visible) syncTranscriptViewport(scroller.current);
  });

  useTurnScrollAnchor(scrollerEl, visible, stickToBottom, rememberScroll, prependAnchor);

  const [turnCache] = useState(() => new TranscriptTurnCache());
  const turns = turnCache.group(blocks, managed);
  const latestAssistantTurn = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index--)
      if (turns[index].some(isProseBlock)) return index;
    return -1;
  }, [turns]);
  const {
    visibleTurnCount,
    firstVisibleTurn,
    visibleTurns,
    turnsRef,
    loadEarlier,
    revealBlock,
  } = useTranscriptPaging({
    turns,
    scroller,
    prependAnchor,
    stickToBottom,
    distanceFromBottom,
    wheelHold,
    pinTranscript,
    rememberScroll,
    onRevealReady,
  });

  const navigateToBlock = useCallback(
    (blockId: string | null, query = ""): boolean => {
      if (!blockId) {
        setSearchCurrent(null);
        setSearchQuery("");
        return true;
      }
      const turn = turnsRef.current.find((item) =>
        item.some((block) => block.id === blockId),
      );
      if (!turn || !revealBlock(blockId)) return false;
      const turnId = turn[0].id;
      // A result inside folded work needs its row rendered before measuring it.
      flushSync(() => {
        setOpenWork((current) =>
          current[turnId] ? current : { ...current, [turnId]: true },
        );
        setSearchCurrent(blockId);
        setSearchQuery(query);
      });
      const el = scroller.current;
      if (!el) return false;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      const align = () => {
        const target =
          el.querySelector<HTMLElement>(
            '[data-transcript-search-current="true"]',
          ) ??
          el.querySelector<HTMLElement>(
            `[data-transcript-turn="${CSS.escape(turnId)}"]`,
          );
        if (!target) return;
        const wordRect = query
          ? transcriptWordRanges(el, query).current?.getBoundingClientRect?.()
          : null;
        const targetTop =
          wordRect && wordRect.height > 0
            ? wordRect.top
            : target.getBoundingClientRect().top;
        const delta = targetTop - el.getBoundingClientRect().top - 42;
        if (Math.abs(delta) > 2) {
          el.scrollTop += delta;
          rememberScroll(el);
        }
      };
      align();
      requestAnimationFrame(align);
      return true;
    },
    [revealBlock, rememberScroll],
  );

  useEffect(() => {
    onNavigateReady?.(navigateToBlock);
  }, [navigateToBlock, onNavigateReady]);

  useEffect(() => {
    const el = scroller.current;
    const owner = highlightOwner.current;
    if (!el || !visible || !searchQuery) {
      clearTranscriptHighlights(owner);
      return;
    }
    let frame = 0;
    let pending: MutationRecord[] = [];
    const paint = () => {
      const { matches, current } = transcriptWordRanges(el, searchQuery);
      paintTranscriptHighlights(owner, matches, current);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) pending.push(record);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const changed = pending;
        pending = [];
        if (transcriptMutationNeedsRepaint(changed, searchQuery)) paint();
      });
    });
    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    paint();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTranscriptHighlights(owner);
    };
  }, [visible, searchQuery, searchCurrent, visibleTurnCount, openWork]);

  return createElement(
    TranscriptPlatformContext.Provider,
    { value: renderingPlatform },
    <div
      ref={setScroller}
      className="agent-transcript h-full overflow-y-auto overscroll-none [overflow-anchor:none] font-mono text-[13px] leading-5"
    >
      {/* Contain wide rows inside the vertical scroller; code blocks and tables
          retain their own horizontal scrolling. Clip the content column so
          WebKit can keep scrolling the transcript vertically. */}
      <div className="desktop-transcript-content mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-1 overflow-x-clip wrap-anywhere pb-8">
        {firstVisibleTurn > 0 ? (
          <div className="flex justify-center px-4 @md:px-6 py-3">
            <button
              type="button"
              className="rounded-md bg-content/8 px-2.5 py-1.5 font-sans text-[12px] text-content/60 hover:bg-content/12 hover:text-content"
              onClick={loadEarlier}
            >
              {uiT("Load earlier messages")}
            </button>
          </div>
        ) : null}
        {visibleTurns.map((turn, turnIndex) => {
          const isLastTurn = firstVisibleTurn + turnIndex === turns.length - 1;
          const userBlock = turnUserBlock(turn, managed);
          const durationMs = userBlock?.durationMs;
          const settled = !(busy && isLastTurn);
          const proposals = turn.filter((block) => block.orchestration);
          const workflowCards = workflowParent ? turn.filter((block) => block.workflowRun) : [];
          // Proposals are turn results, like the changes card. Keep them out
          // of the live work and append them after all of the lead's output.
          const items = turnCache.turnItems(turn, settled);
          // Earlier activity groups have already been followed by prose or
          // more work. Only the last one can still be the live group.
          const foldedAt = lastActivityIndex(items);
          const initialThinkingAt = initialThinkingIndex(items);
          const startedAt = userBlock
            ? turnStartTimes.get(userBlock.id)
            : undefined;
          // The agent starting its answer is the end of the work: fold the
          // groups then, not when the turn finally settles, so the collapse
          // never lands under the text you have already started reading.
          const answering =
            foldedAt >= 0 &&
            items
              .slice(foldedAt + 1)
              .some(
                (item) => item.type === "block" && isProseBlock(item.block),
              );
          const workStillRunning = activityStillRunning(turn);
          // New turns carry immutable model provenance. Legacy turns do not,
          // so omit their model instead of rewriting history from the picker.
          const turnModel = userBlock?.turnModel;
          const turnHarness = harness
            ? (turnModel?.harness ?? harnessForTurn(blocks, turn, harness))
            : undefined;
          // Work the turn has already answered for folds away behind one line,
          // leaving the prompt and the answer to it.
          const turnId = turn[0].id;
          const fold = foldableWork(items);
          const folded = fold ? foldedBlocks(items, fold) : [];
          const workOpen = openWork[turnId] ?? false;
          // The fold line stays at the start of the work. Clients with a
          // footer keep the clock under the reply and the work summary here.
          const live = visible && !settled && !preparingHandoff;
          const turnModelName =
            turnModel?.name ?? (live ? currentModelName : undefined);
          // The fold line speaks for the main agent only. A delegated run has
          // its own row, which says who is working and how it went, so saying
          // it again here would be two lines telling the same story.
          const foldTitle: ReactNode = live ? (
            <LiveFoldTitle
              startedAt={startedAt}
              paused={waitingForApproval}
              waitingLabel={
                managed && waitingForApproval
                  ? "Waiting for orchestrator"
                  : pendingQuestion
                    ? "Waiting for answers"
                    : undefined
              }
              background={backgroundTasks}
              executionState={executionState}
              modelName={turnModelName}
              clockHidden={clockInFooter}
              responding={items.some((item) =>
                item.type !== "block" ||
                (item.block.role !== "user" && item.block.role !== "system"),
              )}
            />
          ) : durationMs != null && !liveClockInFooter ? (
            formatWorkingDuration(durationMs, turnModelName, true)
          ) : (
            workSummaryLine(folded)
          );
          const showFoldLine =
            live || (durationMs != null && !liveClockInFooter) || !!fold;
          // It sits where the work starts, from before there is any: the row
          // is there from the first token, so nothing shoves the answer down
          // when the turn folds.
          // A card the work cannot fold across (an answered question, a plan)
          // starts the fold below it, but the line stays where the work began.
          const firstWork = firstFoldableIndex(items);
          const foldLineAt =
            firstWork >= 0
              ? Math.min(firstWork, fold?.start ?? firstWork)
              : (fold?.start ?? items.length);
          const isCurrentItem = (item: TurnItem) =>
            item.type === "block"
              ? item.block.id === searchCurrent
              : item.blocks.some((block) => block.id === searchCurrent);
          // A closing row keeps the look it had before the fold, so a live
          // group shrinks away whole instead of first snapping to its summary.
          const renderItemContent = (item: TurnItem, itemIndex: number, closing = false) =>
            item.type === "subagents" ? (
              <SubagentStack
                key={item.blocks[0].id}
                blocks={item.blocks}
                cwd={cwd}
                live={live}
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
            ) : item.type === "activity" ? (
              itemIndex === initialThinkingAt ? (
                <InitialThinking
                  key={item.blocks[0].id}
                  live={visible && !settled}
                  executionState={!settled ? executionState : undefined}
                />
              ) : (
                <ActivityPhases
                  key={item.blocks[0].id}
                  blocks={item.blocks}
                  cwd={cwd}
                  done={
                    !closing &&
                    (settled ||
                      itemIndex < foldedAt ||
                      (answering && !workStillRunning))
                  }
                  onApproval={onApproval}
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                />
              )
            ) : (
              <TranscriptBlock
                key={item.block.id}
                block={item.block}
                questionPending={item.block.id === pendingQuestionHistoryId}
                onQuestionFollowUp={onQuestionFollowUp}
                harness={turnHarness}
                layout={transcriptLayout}
                visible={item.block.role === "user" ? visible : undefined}
                stickyIndex={firstVisibleTurn + turnIndex + 1}
                // Prose reads the same wherever it lands: under the fold
                // line at the top of the turn, or under the work it follows.
                underLine={
                  isProseBlock(item.block) &&
                  itemIndex > 0 &&
                  (items[itemIndex - 1]?.type === "activity" ||
                    items[itemIndex - 1]?.type === "subagents" ||
                    (itemIndex === foldLineAt && showFoldLine))
                }
                onApproval={onApproval}
                onSaveNote={onSaveNote}
                onSendDraft={onSendDraft}
                onRemoveDraft={onRemoveDraft}
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
                onOpenPlan={onOpenPlan}
                onBuildPlan={onBuildPlan}
                planDecision={item.block.id === decidingPlanId}
                planBusy={!!busy}
                planHarness={planBuildTargets ? harness : undefined}
                planModel={model}
                planModelSettings={modelSettings}
                cwd={cwd}
                onEditLastTurn={
                  onEditLastTurn &&
                  settled &&
                  item.block.role === "user" &&
                  item.block.id === editableUserBlockId &&
                  !item.block.draft
                    ? onEditLastTurn
                    : undefined
                }
                editing={
                  editingLastTurn &&
                  item.block.role === "user" &&
                  item.block.id === editableUserBlockId
                }
              />
            );
          const renderItem = (item: TurnItem, itemIndex: number, closing = false) => {
            const content = renderItemContent(item, itemIndex, closing);
            return messageMotion === "slide" && !(item.type === "block" && item.block.role === "user")
              ? <TranscriptContentMotion arrive={messageArrives(turnItemKey(item))}>
                  {content}
                </TranscriptContentMotion>
              : content;
          };
          // The fold reaches across a stack of delegated runs, but those rows
          // do not collapse with it: they are lifted out and parked under the
          // work, where they stay put however often it re-folds.
          const foldEntries = fold
            ? items.slice(fold.start, fold.end + 1).map((entry, offset) => ({
                entry,
                index: fold.start + offset,
              }))
            : [];
          const foldSubagents = foldEntries.filter(
            ({ entry }) => entry.type === "subagents",
          );
          const foldWork = foldEntries.filter(
            ({ entry }) => entry.type !== "subagents",
          );
          // Clients with a step sheet list a settled turn's work there in one tap.
          const sheetFold = !!openActivity && !!fold && !live;
          const foldLineRow = (
            <TurnRow key="work-fold" folded={!showFoldLine}>
              <WorkFoldLine
                title={foldTitle}
                kind={workKind(folded)}
                harness={turnHarness}
                live={live}
                expandable={!!fold}
                open={workOpen && !!fold && !sheetFold}
                sheet={sheetFold ? workDiffStats(folded) : undefined}
                onToggle={() =>
                  sheetFold ? openActivity!(folded) : toggleWork(turnId, workOpen)
                }
              />
            </TurnRow>
          );
          // Prose arriving folds the work before it into a closed row. Rows
          // that just joined the fold close where they stood instead of
          // vanishing in one frame; a settled or freshly opened turn never
          // animates, because its history starts from the fold it already has.
          let closingRows: typeof foldWork = [];
          if (!live) foldHistory.current.delete(turnId);
          else {
            const keys = foldWork.map(({ entry }) => turnItemKey(entry));
            let record = foldHistory.current.get(turnId);
            if (!record) {
              record = { folded: new Set(keys), joined: new Map() };
              foldHistory.current.set(turnId, record);
            }
            const now = performance.now();
            for (const key of keys)
              if (!record.folded.has(key)) {
                record.folded.add(key);
                record.joined.set(key, now);
              }
            for (const [key, at] of record.joined)
              if (now - at > 1000) record.joined.delete(key);
            const joined = record.joined;
            if (!workOpen)
              closingRows = foldWork.filter(({ entry }) =>
                joined.has(turnItemKey(entry)),
              );
          }
          return (
            <div
              key={turn[0].id}
              data-transcript-turn={turnId}
              data-latest-assistant-turn={firstVisibleTurn + turnIndex === latestAssistantTurn || undefined}
              className={`transcript-turn flex min-w-0 flex-col${
                isLastTurn ? " transcript-turn-live" : ""
              }${
                promptAnchor && anchorTurn && isLastTurn && userBlock
                  ? " transcript-turn-anchor"
                  : ""
              }`}
            >
              {/* Keep the waiting fold line in the same keyed list when the
                  first output arrives, so its DOM and motion stay mounted. */}
              {items.flatMap((item, itemIndex) => {
                const inFold =
                  !!fold && itemIndex >= fold.start && itemIndex <= fold.end;
                if (inFold) {
                  if (itemIndex !== fold.start) return [];
                  return [
                    ...(foldLineAt === fold.start ? [foldLineRow] : []),
                    <TurnRow key="work-details" folded={!workOpen}>
                      {() =>
                        foldWork.map(({ entry, index }, offset) => (
                          <div
                            key={turnItemKey(entry)}
                            data-transcript-search-item
                            data-transcript-search-current={
                              isCurrentItem(entry) || undefined
                            }
                            className={`flow-root pb-1 last:pb-0 pl-5 zen-fold-rail ${
                              offset === foldWork.length - 1
                                ? "zen-fold-tail"
                                : ""
                            }${
                              // Prose the trail holds is the agent talking
                              // while it works; the marker lets it read as
                              // process, not result.
                              entry.type === "block" &&
                              isProseBlock(entry.block)
                                ? " zen-fold-prose"
                                : ""
                            }`}
                          >
                            {renderItem(entry, index)}
                          </div>
                        ))
                      }
                    </TurnRow>,
                    ...closingRows.map(({ entry, index }) => (
                      <FoldingRow key={`folding:${turnItemKey(entry)}`}>
                        {() => (
                          <div className="flow-root pb-1">
                            {renderItem(entry, index, true)}
                          </div>
                        )}
                      </FoldingRow>
                    )),
                    // Delegated runs sit under the agent's own work, not
                    // among it: they are a second thing the turn is doing,
                    // and reading them as the first steps of the main trail
                    // is what made them look like its work.
                    ...foldSubagents.map(({ entry, index }) => (
                      <div
                        key={turnItemKey(entry)}
                        data-transcript-search-item
                        data-transcript-search-current={
                          isCurrentItem(entry) || undefined
                        }
                        className="flow-root pb-1"
                      >
                        {renderItem(entry, index)}
                      </div>
                    )),
                  ];
                }
                const row = (
                  <div
                    key={turnItemKey(item)}
                    data-transcript-search-item
                    data-transcript-search-current={
                      isCurrentItem(item) || undefined
                    }
                    className="flow-root pb-1"
                  >
                    {renderItem(item, itemIndex)}
                  </div>
                );
                // The creation card sits under the message that started it: the
                // live one while it is fresh, then the record that message keeps.
                const creation =
                  item.type === "block" && item.block.role === "user"
                    ? worktreeCreation?.afterBlockId === item.block.id
                      ? worktreeCreation
                      : item.block.worktreeCreation
                        ? worktreeCreationFromRecord(
                            item.block.id,
                            item.block.worktreeCreation,
                          )
                        : undefined
                    : undefined;
                const creationRow = creation ? (
                  <div key="worktree-creation" className="px-4 @md:px-6 pt-1 pb-2">
                    <WorktreeCreationCard creation={creation} />
                  </div>
                ) : null;
                if (itemIndex !== foldLineAt)
                  return creationRow ? [row, creationRow] : row;
                return creationRow
                  ? [foldLineRow, row, creationRow]
                  : [foldLineRow, row];
              }).concat(foldLineAt >= items.length ? [foldLineRow] : [])}
              {settled &&
                proposals
                  .filter((block) => block.orchestration?.status !== "planning")
                  .map((block) => (
                    <div
                      key={block.id}
                      className="px-4 @md:px-6 pt-1 pb-2"
                      data-orchestration-result
                    >
                      <OrchestrationPreview block={block} busy={!!busy} />
                    </div>
                  ))}
              {workflowCards.map((block) => (
                <div key={block.id} className="px-4 @md:px-6 pt-1 pb-2" data-workflow-run-card>
                  <WorkflowRunCard block={block} parent={workflowParent!} />
                </div>
              ))}
              {isLastTurn && clockInFooter && cwd ? (
                <AnimatedCollapse expanded={live} className="transcript-live-footer-collapse">
                  {() => (
                    <LiveTurnFooter
                      cwd={cwd}
                      turn={turn}
                      seed={turnId}
                      startedAt={startedAt}
                      waiting={
                        waitingForApproval
                          ? pendingQuestion
                            ? "answers"
                            : "approval"
                          : undefined
                      }
                      background={backgroundTasks}
                      executionState={executionState}
                    />
                  )}
                </AnimatedCollapse>
              ) : null}
              {/* The accessory keeps the pane's props, which go stale once parked. */}
              {!parked && turnAccessory?.(
                turn.find((block) => block.role === "user" && block.checkpointTurnId) ?? userBlock,
                isLastTurn,
              )}
              {durationMs != null && settled ? (
                <AfterTextReveal entries={turn}>
                  <TurnDuration
                    elapsedMs={durationMs}
                    metrics={userBlock?.turnMetrics}
                    labelHidden={showFoldLine && !liveClockInFooter}
                    modelName={turnModelName}
                    completedAt={
                      startedAt != null ? startedAt + durationMs : undefined
                    }
                    copyText={turnCopyText(turn)}
                    onSaveNote={onSaveNote}
                    harness={turnHarness}
                    fromHarness={turnHarness}
                    fromModel={turnModel?.id}
                    onSecondOpinion={
                      onSecondOpinion
                        ? (target) => onSecondOpinion(target, turn)
                        : undefined
                    }
                    onHandoff={
                      onHandoff ? (target) => onHandoff(target, turn) : undefined
                    }
                  />
                </AfterTextReveal>
              ) : null}
              {isLastTurn ? (
                <div ref={transcriptEnd} data-transcript-end aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
      {onAddToChat || onSaveSelectionNote ? (
        <TranscriptSelectionMenu
          selection={selection}
          onAddToChat={onAddToChat}
          onAddToNotes={onSaveSelectionNote}
          onDismiss={dismissSelection}
        />
      ) : null}
    </div>,
  );
}

// Keep hidden panes' local state, and catch up with current props on activation.
export const AgentTranscript = memo(
  function ClockedTranscript(props: Props) {
    const inheritedOffset = useContext(TranscriptClockOffset);
    const parentVisible = useSurfaceVisibility();
    const visible = parentVisible && props.visible !== false && !props.parked;
    return (
      <TranscriptClockOffset.Provider value={props.clockOffsetMs ?? inheritedOffset}>
        <SurfaceVisibilityContext.Provider value={visible}>
          <AgentTranscriptComponent {...props} visible={visible} />
        </SurfaceVisibilityContext.Provider>
      </TranscriptClockOffset.Provider>
    );
  },
  (previous, next) => previous.visible === false && next.visible === false,
);
