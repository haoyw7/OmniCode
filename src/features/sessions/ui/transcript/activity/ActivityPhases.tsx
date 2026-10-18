import { DisclosureChevron } from "../../../../../shared/ui/DisclosureChevron";
import { animate, motion, useMotionValue } from "motion/react";
import { duration, msgTransition, immediateTransition } from "../../../../../shared/motion/tokens";
import { useMotionPreference } from "../../../../../shared/motion/useMotionPreference";
import { agentTranscript } from "../../../model/agentTranscript";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { ChevronRight } from "../../../../../shared/ui/icons";
import {
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../../../../../shared/ui/SurfaceVisibility";
import type { ApprovalDecision } from "../../../../../integrations/harness";
import { TranscriptPlatformContext } from "../../TranscriptPlatform";
import { useLivePhaseScroll } from "../useLivePhaseScroll";
import { Shimmer } from "../../../../../shared/ui/Shimmer";
import { type Block } from "../../../model/session";
import { AgentMarkdown } from "../../AgentMarkdown";
import {
  activityPhaseTitle,
  buildActivityPhases,
  isSubagentBlock,
  isThinkingBlock,
  isProseBlock,
  needsApproval,
  subagentBrief,
  subagentModelName,
  subagentName,
  subagentReport,
  toolCallState,
  workDiffStats,
  type ActivityPhase,
} from "../../../model/transcriptActivity";
import { monoCodeWorkSummary } from "../../../model/monocodeToolCall";
import { ActivityPhaseIcon } from "./ActivityPhaseIcon";
import { MonoCodeMark } from "../ToolCall";
import { SubagentMascot, subagentStatusLine } from "./SubagentMascot";
import {
  ActivityInterjectionRow,
  ActivityNoteRow,
  ActivityStatusRow,
  ActivityThinkingRow,
  ActivityToolRow,
} from "./ActivityRows";


/*
 * Tool calls often land in a burst. Each arrival waits for the one before it
 * to finish its whole entrance — rail, branch, row — before starting its own.
 * The first few play at STEP_ENTRANCE_MS; a queue running past
 * STEP_QUEUE_CALM_MS plays the rest faster, down to STEP_ENTRANCE_MIN_MS by
 * STEP_QUEUE_MS, so a long burst still catches up.
 */
const STEP_ENTRANCE_MS = duration.msg * 1000;
const STEP_ENTRANCE_MIN_MS = duration.msg * 1000;
const STEP_QUEUE_CALM_MS = duration.panel * 1000;
const STEP_QUEUE_MS = duration.panel * 1000;

/**
 * The turn's work as phases. Related reasoning and calls stay together while
 * assistant prose remains outside as full-size transcript text. The phase the
 * agent is in stays open; the moment it moves on the phase folds back to its
 * header. Only nested panels and sheet clients bound the live steps' height.
 */
type ActivityPhasesProps = {
  blocks: Block[];
  cwd?: string;
  done?: boolean;
  /** False inside a nested panel, which supplies its own gutter. */
  padded?: boolean;
  /** Nested agent panels keep their work in a bounded live window. */
  scrollLive?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
};

export const ActivityPhases = memo(function ActivityPhases({
  blocks,
  cwd,
  done,
  padded = true,
  scrollLive = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: ActivityPhasesProps) {
  const { openActivity } = useContext(TranscriptPlatformContext);
  const phases = useMemo(() => buildActivityPhases(blocks), [blocks]);

  return (
    <div
      className={`desktop-activity-phases flex min-w-0 flex-col gap-1 ${padded ? "px-4 @md:px-6" : ""}`}
    >
      {phases.map((phase, index) => (
        <ActivityPhaseGroup
          key={phase.id}
          phase={phase}
          cwd={cwd}
          active={!done && index === phases.length - 1}
          scrollLive={scrollLive || !!openActivity}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}, sameActivity);

/**
 * A settled group is the same calls it was on the last token. Comparing the
 * blocks themselves keeps every earlier turn out of the streaming re-render,
 * which is most of what makes a long transcript stutter while the agent works.
 */
function sameActivity(a: ActivityPhasesProps, b: ActivityPhasesProps): boolean {
  return (
    a.cwd === b.cwd &&
    a.done === b.done &&
    a.padded === b.padded &&
    a.scrollLive === b.scrollLive &&
    a.onApproval === b.onApproval &&
    a.onOpenFile === b.onOpenFile &&
    a.onOpenDiff === b.onOpenDiff &&
    a.blocks.length === b.blocks.length &&
    a.blocks.every((block, index) => block === b.blocks[index])
  );
}

/**
 * One phase: a header the whole group hangs off, and the steps under it on a
 * rail. Folding is automatic — the group opens while it is the live one and
 * closes when the agent moves on — until you click, after which it stays where
 * you put it. A step still waiting on you keeps the group open regardless.
 * Main desktop activity stays in transcript flow, so new tools and thoughts
 * advance the same outer scroll as prose. Nested panels and sheet clients
 * keep a short live window pinned to the newest step.
 */
function ActivityPhaseGroup({
  phase,
  cwd,
  active,
  scrollLive,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  phase: ActivityPhase;
  cwd?: string;
  active: boolean;
  scrollLive: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const { openActivity } = useContext(TranscriptPlatformContext);
  const visible = useSurfaceVisibility();
  const [override, setOverride] = useState<boolean | null>(null);
  const waiting = phase.steps.some(needsApproval);
  // Clients with a step sheet keep the live window inline but never unfold a
  // settled group; a step waiting on approval stays inline so it can be answered.
  const sheet = !!openActivity && !waiting;
  const open = waiting || (sheet ? active : (override ?? active));
  const [liveScroller, setLiveScroller] = useState<HTMLDivElement | null>(null);
  useLivePhaseScroll(
    liveScroller,
    scrollLive && visible && active && open,
    phase.steps,
  );
  // Steps already here when the group mounted, or that landed while it was
  // folded, are history: only a step you watch arrive gets the entrance.
  const settled = useRef<Set<Block["id"]> | null>(null);
  settled.current ??= new Set(phase.steps.map((step) => step.id));
  const wasVisible = useRef(visible);
  if (!visible || !wasVisible.current)
    for (const step of phase.steps) settled.current.add(step.id);
  useLayoutEffect(() => {
    wasVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    for (const step of phase.steps) settled.current?.add(step.id);
  }, [phase.steps]);
  const turnFor = useStepQueue(visible);
  const title = activityPhaseTitle(phase, active);
  const monoCodePhase = !!monoCodeWorkSummary(phase.steps, active);
  // Opening a group on purpose is also how you read the line that titled it,
  // whole. The auto-open while it runs is a live view, not a reading one, and
  // a one-line note the header already shows in full has nothing to add.
  const headline =
    override === true && phase.headline && headlineHasMore(phase.headline)
      ? phase.headline
      : undefined;
  const inert = phase.steps.length === 0 && !headlineHasMore(phase.headline);

  // A lone call the agent never introduced is not a group: a header repeating
  // the single row under it says nothing twice.
  if (!phase.headline && phase.steps.length === 1) {
    return (
      <ActivityRow
        block={phase.steps[0]}
        cwd={cwd}
        live={active}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  const label = active ? (
    <Shimmer className="min-w-0 truncate font-sans text-sm" duration={1.6}>
      {title}
    </Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and
    // only the answer reads at full strength.
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground-subtlest transition-colors duration-200 group-hover:text-content/80">
      {title}
    </span>
  );

  // A line the agent wrote with nothing under it is just that line.
  if (inert) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-1">
        <ActivityPhaseIcon kind={phase.kind} />
        {label}
      </div>
    );
  }

  const diff = sheet ? workDiffStats(phase.steps) : undefined;
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={sheet ? undefined : open}
        aria-haspopup={sheet ? "dialog" : undefined}
        aria-label={
          sheet
            ? uiT("Show the steps for {value0}", { value0: String(title) })
            : open
              ? uiT("Hide the steps for {value0}", { value0: String(title) })
              : uiT("Show the steps for {value0}", { value0: String(title) })
        }
        onClick={() => (sheet ? openActivity!(phase.steps) : setOverride(!open))}
        className="group group/activity-disclosure flex w-full min-w-0 items-center gap-1.5 py-1 text-left"
        data-activity-sheet={sheet || undefined}
      >
        {/*
         * The two icons share one 14px box, so the swap is instant: fading
         * between them leaves both half-drawn on top of each other.
         * Sheet triggers keep their icon; their chevron lives at the row's end.
         */}
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          {monoCodePhase ? (
            <MonoCodeMark
              className={`size-3.5 ${sheet ? "" : "group-hover/activity-disclosure:opacity-0 group-focus-visible/activity-disclosure:opacity-0"}`}
            />
          ) : (
            <ActivityPhaseIcon
              kind={phase.kind}
              className={
                sheet
                  ? ""
                  : "group-hover/activity-disclosure:opacity-0 group-focus-visible/activity-disclosure:opacity-0"
              }
            />
          )}
          {!sheet && (
            <DisclosureChevron expanded={open} className="absolute size-3.5 opacity-0 group-hover/activity-disclosure:opacity-100 group-focus-visible/activity-disclosure:opacity-100" />
          )}
        </span>
        {label}
        {diff && (diff.additions > 0 || diff.deletions > 0) && (
          <span className="activity-diff-badge shrink-0 font-mono text-xs">
            <span className="text-emerald-400">+{diff.additions}</span>
            <span className="ms-1 text-red-400">−{diff.deletions}</span>
          </span>
        )}
        {sheet && (
          <ChevronRight className="size-3.5 shrink-0 text-foreground-subtlest" />
        )}
      </button>
      <div className="zen-phase-body" data-open={open}>
        <AnimatedCollapse expanded={open}>
          {() => (
            <div
              ref={setLiveScroller}
              className={
                scrollLive && (active || !open) ? "zen-phase-live" : undefined
              }
            >
              <div className="flex min-w-0 flex-col">
                {headline ? (
                  <div className="zen-phase-step py-1">
                    <AgentMarkdown
                      className={
                        headline.role === "reasoning"
                          ? "agent-reasoning"
                          : undefined
                      }
                      text={headline.text}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                ) : null}
                {phase.steps.map((block) => {
                  const arriving = visible && active && !settled.current?.has(block.id);
                  return (
                    <PhaseStep
                      key={block.id}
                      live={active}
                      turn={arriving ? turnFor(block.id) : undefined}
                    >
                      <ActivityRow
                        block={block}
                        cwd={cwd}
                        live={active}
                        onApproval={onApproval}
                        onOpenFile={onOpenFile}
                        onOpenDiff={onOpenDiff}
                      />
                    </PhaseStep>
                  );
                })}
              </div>
            </div>
          )}
        </AnimatedCollapse>
      </div>
    </div>
  );
}

type StepTurn = { wait: number; pace: number };

/**
 * A group's queue of arriving steps: how long each one waits for the step
 * before it to finish, and how long its own entrance then takes. A step keeps
 * the turn it was first given however often the group renders.
 */
function useStepQueue(visible: boolean) {
  const queue = useRef({ next: 0, turns: new Map<Block["id"], StepTurn>() });
  if (!visible) {
    queue.current.next = 0;
    queue.current.turns.clear();
  }

  return (id: Block["id"]) => {
    const { turns } = queue.current;
    let turn = turns.get(id);
    if (!turn) {
      const now = performance.now();
      const start = Math.max(now, queue.current.next);
      const wait = start - now;
      const backlog =
        (STEP_QUEUE_MS - wait) / STEP_QUEUE_CALM_MS;
      const pace = Math.max(
        STEP_ENTRANCE_MIN_MS,
        STEP_ENTRANCE_MS * Math.min(1, backlog),
      );
      queue.current.next = start + pace;
      turn = { wait, pace };
      turns.set(id, turn);
    }
    return turn;
  };
}

/**
 * One step on a phase's rail. A step that lands while you watch makes room
 * first — what is below glides down, the rail runs into the gap and branches
 * off — and only then does the row fade in. One that lands behind others
 * stays out of the layout until its turn. The grid and clipping that does
 * that come off once the row has settled, so nothing inside stays clipped.
 */
function PhaseStep({
  live,
  turn: arrival,
  children,
}: {
  live: boolean;
  /** Set only on the render a step arrives in; later renders drop it. */
  turn?: StepTurn;
  children: ReactNode;
}) {
  const visible = useSurfaceVisibility();
  const [turn] = useState(arrival);
  const [stage, setStage] = useState<"waiting" | "entering" | "settled">(() =>
    !turn ? "settled" : turn.wait > 0 ? "waiting" : "entering",
  );
  if (!visible && stage !== "settled") setStage("settled");

  const reduced = useMotionPreference();
  const element = useRef<HTMLDivElement>(null);
  const opacity = useMotionValue(turn && visible && !reduced ? 0 : 1);
  useLayoutEffect(() => {
    if (!turn) return;
    if (reduced || !visible) {
      opacity.jump(1);
      setStage("settled");
      return;
    }
    const fade = animate(opacity, 1, { ...msgTransition, delay: turn.wait / 1000,
      onUpdate: value => { if (value > 0) setStage(current => current === "waiting" ? "entering" : current); },
    });
    return () => fade.stop();
  }, [turn, visible, reduced, opacity]);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !turn || stage === "waiting") return;
    // Measure auto height after the queued row joins the layout.
    const height = animate([node], { height: stage === "entering" && visible && !reduced ? [0, "auto"] : "auto" }, {
      ...(reduced || !visible || stage === "settled" ? immediateTransition : msgTransition),
      onComplete: () => setStage("settled"),
    });
    return () => height.stop();
  }, [turn, stage, visible, reduced]);
  return (
    <motion.div ref={element} className="zen-phase-step" style={{ opacity }}
      data-live={live || undefined}
      data-waiting={stage === "waiting" || undefined}
      data-entering={stage === "entering" || undefined}
    >{children}</motion.div>
  );
}

/**
 * Every delegated run in the turn, one row each. The main transcript cycles —
 * work folds behind a line, prose replaces prose — and a subagent you are
 * watching must not move while that happens, so these rows are never part of a
 * fold and hold their place from the moment the agents start.
 *
 * A row is a mascot, a name, and what that agent is doing right now. Click it
 * and the agent's own trail opens underneath.
 */
export function SubagentStack({
  blocks,
  cwd,
  live = false,
  embedded = false,
  onOpenFile,
  onOpenDiff,
}: {
  blocks: Block[];
  cwd?: string;
  live?: boolean;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  return (
    <div className={`flex min-w-0 flex-col ${embedded ? "" : "px-4 @md:px-6"}`}>
      {blocks.map((block) => (
        <SubagentRow
          key={block.id}
          block={block}
          cwd={cwd}
          live={live}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}

/**
 * One delegated run's row, stateful about being opened. A run that died opens
 * itself, so the provider's reason is not buried behind a face that looks like
 * every other finished one. A click takes the row over from there and it stays
 * where the reader puts it. The same row serves inside a settled turn's trail,
 * where the run sits as one step of the work it was spawned from.
 */
function SubagentRow({
  block,
  cwd,
  live = false,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? toolCallState(block) === "rejected";
  return (
    <SubagentPanel
      block={block}
      cwd={cwd}
      live={live}
      open={open}
      onToggle={() => setOverride(!open)}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/**
 * One delegated run: its name, what it is doing, and — once opened — the trail
 * it left, with the same tool rows, thinking and prose the main transcript
 * shows. While it runs the trail is a short window pinned to the newest step,
 * so a subagent doing hundreds of things cannot push the turn off the screen.
 */
function SubagentPanel({
  block,
  cwd,
  live = false,
  open,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const { openAgent } = useContext(TranscriptPlatformContext);
  // Desktop opens a conversation tab; never expose its prose in the parent.
  open = !openAgent && open;
  const name = subagentName(block);
  const brief = subagentBrief(block);
  const model = subagentModelName(block);
  const state = toolCallState(block);
  const active = live && state === "pending";
  const steps = block.agentRun?.steps ?? [];
  // The run's trail as transcript blocks, so the panel groups it the way the
  // main transcript groups the agent's own work: what it said, then the calls
  // that line introduced, folding behind it once it moves on.
  const stepBlocks = useMemo(() => agentTranscript(block), [block.agentRun]);
  const status = subagentStatusLine(block, steps);
  const report = subagentReport(block);
  const failed = state === "rejected";

  // The name takes the room it needs and gives the rest back: a provider that
  // names a run with its whole brief must not push the row off the pane.
  const label = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      {active ? (
        <Shimmer
          className="min-w-0 flex-1 truncate font-sans text-sm"
          duration={1.6}
        >
          {name}
        </Shimmer>
      ) : (
        <span
          className={`min-w-0 flex-1 truncate font-sans text-sm transition-colors duration-200 ${
            state === "rejected"
              ? "text-red-400"
              : "text-content/75 group-hover:text-content"
          }`}
        >
          {name}
        </span>
      )}
      {model || status ? (
        <span className="flex min-w-0 max-w-[55%] shrink-0 items-baseline gap-2 font-sans text-ui-sm text-content/40">
          {model ? (
            <span
              className="truncate"
              title={uiT("Model: {value0}", { value0: String(model) })}
            >
              {model}
            </span>
          ) : null}
          {status ? <span className="shrink-0">{status}</span> : null}
        </span>
      ) : null}
    </span>
  );

  // A run that has not reported a step yet has nothing to open into. The row
  // still holds its place, so the chevron arriving does not move anything.
  if (!openAgent && stepBlocks.length === 0 && !report) {
    return (
      <div
        aria-label={uiT("Subagent: {value0}", { value0: String(name) })}
        title={brief}
        className="-mx-1.5 flex min-w-0 items-center gap-2 px-1.5 py-1"
      >
        <SubagentMascot name={name} state={state} active={active} />
        {label}
        <span className="size-3.5 shrink-0" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={openAgent ? undefined : open}
        aria-label={
          open && !openAgent
            ? uiT("Hide {value0}'s work", { value0: String(name) })
            : uiT("Show {value0}'s work", { value0: String(name) })
        }
        title={brief}
        onClick={openAgent ? () => openAgent(block) : onToggle}
        // An open row keeps the wash it lit up under the cursor, so the panel
        // below reads as hanging off it rather than off the transcript.
        className={`group -mx-1.5 flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-200 hover:bg-content/5 ${
          open ? "bg-content/8" : ""
        }`}
      >
        <SubagentMascot name={name} state={state} active={active} />
        {label}
        <DisclosureChevron expanded={open} className="size-3.5 shrink-0" />
      </button>
      <div className="zen-phase-body" data-open={open}>
        <AnimatedCollapse expanded={!openAgent && open}>
          {() => (
            /*
             * No scroll window of its own. Each phase inside already keeps the
             * group the run is working in to a short pinned window; wrapping a
             * second window around them nests one 17.5rem scroller inside
             * another, and the inner one can never reach its own last row.
             */
            <div className="flex min-w-0 flex-col pb-1">
              <ActivityPhases
                blocks={stepBlocks}
                cwd={cwd}
                done={!active}
                padded={false}
                scrollLive
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
              {report ? (
                <div className="zen-phase-step py-1">
                  {failed ? (
                    <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-ui-sm leading-5 text-red-400/80">
                      {report}
                    </pre>
                  ) : (
                    <AgentMarkdown
                      text={report}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                    />
                  )}
                </div>
              ) : null}
            </div>
          )}
        </AnimatedCollapse>
      </div>
    </div>
  );
}

/** Whether the line that titled a group has more in it than the header shows. */
function headlineHasMore(block?: Block): boolean {
  if (!block) return false;
  return block.role === "reasoning" || /\n\s*\n/.test(block.text.trim());
}

/**
 * One step of the agent's work, whatever that step was: a tool call, a thought,
 * a paragraph. Each row keeps a type icon beside the phase rail.
 */
function ActivityRow({
  block,
  cwd,
  live = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  if (isThinkingBlock(block)) {
    return (
      <ActivityThinkingRow
        block={block}
        cwd={cwd}
        expandable
        onOpenFile={onOpenFile}
      />
    );
  }
  if (block.interjection) {
    return <ActivityInterjectionRow block={block} />;
  }
  if (block.role === "system") {
    return <ActivityStatusRow block={block} />;
  }
  if (isProseBlock(block)) {
    return (
      <ActivityNoteRow
        block={block}
        cwd={cwd}
        expandable
        onOpenFile={onOpenFile}
      />
    );
  }
  // Only a settled turn routes a delegated run here; live turns pin the row
  // outside the trail. Either way it is the same row, so it still opens onto
  // the agent's own work.
  if (isSubagentBlock(block)) {
    return (
      <SubagentRow
        block={block}
        cwd={cwd}
        live={live}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }
  return (
    <ActivityToolRow
      block={block}
      cwd={cwd}
      live={live}
      onApproval={onApproval}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}
