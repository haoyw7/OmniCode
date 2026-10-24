import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { immediateTransition, panelTransition, popAnimate, popExit, popInitial } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { useListReorderMotion } from "../../../shared/hooks/useListReorderMotion";
import { mergeOrderedSubset } from "../../../shared/lib/reorder";
import { usePreferenceState } from "../../settings/model/usePreferenceState";
import { loadStatusCardOrder, saveStatusCardOrder, useStatusCardsVisible, type StatusCardId } from "../model/statusCardOrder";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { Check, CircleAlert, FileScript, Folder, GitBranch, GitCompare, GripVertical, Internet, Laptop } from "../../../shared/ui/icons";
import { prettyParent, projectName } from "../../../shared/lib/paths";
import { useSessionHeaderActions } from "../../workspace/model/SessionHeaderActions";
import { useRemoteMachines } from "../../connections/model/connections";
import { isSharedHostMachine, parseRemotePath } from "../../connections/model/remoteProjects";
import type { Block, ContextUsage, ProviderRateLimits } from "../../../contracts/session";
import { contextPercent } from "../../../domain/contextUsage";

import { buildSessionStatusPanelModel, focusedTaskWindow, type SessionStatusGit, type SessionStatusPanelModel } from "../model/sessionStatusPanel";
import { taskListProgressLabel } from "../../../domain/taskList";
import { TaskState } from "./TaskListPreview";
import { TerminalSpinner } from "../../../shared/ui/TerminalSpinner";
import { ContextUsageDetails } from "./ContextUsageDetails";
import { ProviderUsageBar } from "./ProviderUsageBar";
import { hasSessionUsage, type UsageSession } from "../../providers/model/sessionUsage";
import { LOW_HEADROOM_PERCENT } from "../../providers/model/accountUsageStatus";
import { clampUsedPercent, formatUsagePercent, formatWindowLabel } from "../../../domain/rateLimits";

import { useUsageClock } from "../../providers/model/useProviderUsage";
import { backgroundTaskItems } from "../model/backgroundTasks";
import { BackgroundTasksPanel, BackgroundTasksSummary } from "./BackgroundTasksPanel";
import { TranscriptClockOffset } from "./transcript/transcriptClock";

/**
 * Card width, distance from the pane edge and the smallest gap kept before the
 * conversation; together they make `--desktop-status-rail-reserve`.
 */
const RAIL_WIDTH_REM = 16;
const RAIL_INSET_REM = 0.75;
const RAIL_GAP_PX = 24;
/** Fallback for `--desktop-conversation-min-width`. */
const CONVERSATION_MIN_PX = 420;

// Folded cards stay folded across sessions and pane remounts, but not the app.
const foldedCards = new Set<string>();

/** The cards show unless the conversation beside them would drop below its minimum width. */
export function railFits(width: number, minimum = CONVERSATION_MIN_PX, rem = 16): boolean {
  return width - ((RAIL_WIDTH_REM + RAIL_INSET_REM) * rem + RAIL_GAP_PX) >= minimum;
}

/** The panel instance that last marked each pane row. */
const rowOwners = new WeakMap<HTMLElement, object>();

/**
 * Marks the pane row with `data-status-rail` while the cards show. CSS then
 * keeps the conversation centered in the whole pane until it would come within
 * the gap of the cards, and shifts it inside the transcript scroller and the
 * composer lane, so the scrollbar stays at the pane edge. A pooled transcript
 * moved to another pane follows that pane's mark.
 */
function useRailFits(scope: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const element = scope.current;
    if (!enabled) {
      setFits(false);
      return;
    }
    if (!element || typeof ResizeObserver === "undefined") return;
    // Read once: the tokens do not change while the pane is mounted.
    const minimum =
      parseFloat(getComputedStyle(element).getPropertyValue("--desktop-conversation-min-width")) ||
      CONVERSATION_MIN_PX;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // An exiting panel can outlive the one replacing it; only the owner clears.
    const owner = {};
    let previous: boolean | undefined;
    const apply = (width: number) => {
      const next = railFits(width, minimum, rem);
      if (next === previous) return;
      previous = next;
      rowOwners.set(element, owner);
      element.toggleAttribute("data-status-rail", next);
      setFits(next);
    };
    apply(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) apply(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(element, { box: "border-box" });
    return () => {
      observer.disconnect();
      if (rowOwners.get(element) === owner) {
        rowOwners.delete(element);
        element.removeAttribute("data-status-rail");
      }
    };
  }, [scope, enabled]);
  return fits;
}

/**
 * Session cards on the right of the conversation: environment, changes,
 * progress, context and usage. `scope` is the pane row the cards float in.
 */
export function SessionStatusPanel({
  blocks,
  backgroundTasks,
  busy,
  git,
  cwd,
  branch,
  context,
  usage,
  scope,
  onNavigate,
  onOpenAgent,
  onStopBackgroundTask,
  clockOffsetMs = 0,
}: {
  blocks: Block[];
  backgroundTasks?: string[];
  busy: boolean;
  git: SessionStatusGit | null;
  /** The project folder, local or `remote://`. */
  cwd: string;
  branch?: string;
  context?: ContextUsage;
  usage?: UsageSession;
  scope: RefObject<HTMLElement | null>;
  onNavigate: (blockId: string) => void;
  onOpenAgent?: (block: Block) => void;
  onStopBackgroundTask?: (taskId: string) => Promise<void>;
  clockOffsetMs?: number;
}) {
  const model = useMemo(
    () => buildSessionStatusPanelModel({ blocks, backgroundTasks, busy, git }),
    [blocks, backgroundTasks, busy, git],
  );
  const statusCardsVisible = useStatusCardsVisible();
  const fits = useRailFits(scope, statusCardsVisible);
  const reduced = useMotionPreference();
  const { t: uiT } = useTranslation();
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [initialTaskId, setInitialTaskId] = useState<string>();
  const [clearedTasks, setClearedTasks] = useState<Set<string>>(() => new Set());
  const background = useMemo(() => backgroundTaskItems(blocks, backgroundTasks)
    .filter((task) => task.state === "running" || !clearedTasks.has(task.id)), [blocks, backgroundTasks, clearedTasks]);
  const openBackground = (id?: string) => { setInitialTaskId(id); setBackgroundOpen(true); };
  const summary = <BackgroundTasksSummary tasks={background} onOpen={openBackground} onStop={onStopBackgroundTask} />;
  return (
    <TranscriptClockOffset.Provider value={clockOffsetMs}>
    <AnimatePresence propagate>
      {fits ? (
        <RailFrame
          reduced={reduced}
          aria-label={uiT("Status")}
          data-session-status
          className="scrollbar-none absolute top-2 z-30 flex max-h-[calc(100%_-_1rem)] flex-col overflow-y-auto"
          style={{ right: `${RAIL_INSET_REM}rem`, width: `${RAIL_WIDTH_REM}rem` }}
        >
          <RailCards
            model={model}
            cwd={cwd}
            branch={branch}
            context={context}
            usage={usage}
            backgroundContent={background.length ? summary : undefined}
            onNavigate={onNavigate}
            onOpenAgent={
              onOpenAgent
                ? (blockId) => {
                    const block = blocks.find((entry) => entry.id === blockId);
                    if (block) onOpenAgent(block);
                  }
                : undefined
            }
          />
        </RailFrame>
      ) : statusCardsVisible && background.length ? (
        <RailFrame key="background-compact" reduced={reduced} data-background-tasks-compact className="background-tasks-compact">
          <button type="button" onClick={() => openBackground()} className="background-task-open font-medium">{uiT("Background tasks")}</button>
          {summary}
        </RailFrame>
      ) : null}
      {backgroundOpen && statusCardsVisible ? <BackgroundTasksPanel key="background-panel" tasks={background} initialTaskId={initialTaskId}
        onClose={() => setBackgroundOpen(false)} onStop={onStopBackgroundTask}
        onClear={() => setClearedTasks((current) => new Set([...current, ...background.filter((task) => task.state !== "running").map((task) => task.id)]))} /> : null}
    </AnimatePresence>
    </TranscriptClockOffset.Provider>
  );
}

function RailFrame({ reduced, ...props }: React.ComponentProps<typeof motion.aside> & { reduced: boolean }) {
  const present = useIsPresent();
  return <motion.aside {...props}
    initial={reduced ? false : popInitial} animate={popAnimate} exit={popExit}
    transition={reduced ? immediateTransition : panelTransition}
    inert={!present} aria-hidden={!present || undefined}
  />;
}

function RailCards({
  model,
  cwd,
  branch,
  context,
  usage,
  onNavigate,
  onOpenAgent,
  backgroundContent,
}: {
  model: SessionStatusPanelModel;
  cwd: string;
  branch?: string;
  context?: ContextUsage;
  usage?: UsageSession;
  onNavigate: (blockId: string) => void;
  onOpenAgent?: (blockId: string) => void;
  backgroundContent?: ReactNode;
}) {
  const { t: uiT } = useTranslation();
  const actions = useSessionHeaderActions();
  const list = useRef<HTMLDivElement>(null);
  const [order, setOrder] = usePreferenceState(loadStatusCardOrder);
  const [moreTasks, setMoreTasks] = useState(false);
  const tasks = model.tasks;
  const span = tasks ? focusedTaskWindow(tasks) : null;
  const folded = tasks && span ? tasks.length - (span.end - span.start) : 0;
  const percent = contextPercent(context);
  const cards = [
      <Card
        key="environment"
        id="environment"
        title={uiT("Environment")}
        foldedMeta={
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-4 text-content/45">
            <span className="min-w-0 truncate" title={environmentPath(cwd)}>
              {projectName(environmentPath(cwd))}
            </span>
            {branch ? <>
              <span className="shrink-0">·</span>
              <span className="min-w-0 truncate" title={branch}>{branch}</span>
            </> : null}
          </span>
        }
      >
        <EnvironmentRows cwd={cwd} branch={branch} />
      </Card>,
      model.git ? (
        <Card
          key="changes"
          id="changes"
          title={uiT("Changes")}
          foldedMeta={<DiffCounts additions={model.git.additions} deletions={model.git.deletions} />}
        >
          <RowButton
            disabled={!actions}
            title={uiT("Review changes")}
            onClick={() => {
              if (actions && !actions.changesOpen) actions.toggleChanges();
            }}
          >
            <RowIcon><GitCompare /></RowIcon>
            {model.git.additions || model.git.deletions ? (
              <DiffCounts additions={model.git.additions} deletions={model.git.deletions} />
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {uiT(model.git.files === 1 ? "{count} file changed" : "{count} files changed",
                  { count: model.git.files ?? 0 })}
              </span>
            )}
          </RowButton>
        </Card>
      ) : null,
      tasks && span ? (
        <Card key="tasks" id="tasks" title={uiT("Tasks")} meta={taskListProgressLabel(tasks, uiT)}>
          <ol>
            {folded > 0 ? (
              <>
                <AnimatedCollapse expanded={moreTasks} motion="height">
                  {() => <TaskRows items={tasks.slice(0, span.start)} />}
                </AnimatedCollapse>
                <TaskRows items={tasks.slice(span.start, span.end)} />
                <AnimatedCollapse expanded={moreTasks} motion="height">
                  {() => <TaskRows items={tasks.slice(span.end)} />}
                </AnimatedCollapse>
                <li>
                  <button
                    type="button"
                    onClick={() => setMoreTasks((value) => !value)}
                    className="w-full rounded-md py-1 pr-2 pl-8 text-left font-mono text-[11px] text-content/45 hover:bg-content/4 hover:text-content/70"
                  >
                    {moreTasks
                      ? uiT("Show fewer")
                      : uiT("+{count} more", { count: String(folded) })}
                  </button>
                </li>
              </>
            ) : (
              <TaskRows items={tasks} />
            )}
          </ol>
        </Card>
      ) : null,
      model.plans.length ? (
        <Card key="plans" id="plans" title={uiT("Plans")}>
          {model.plans.map((plan) => (
            <RowButton key={plan.blockId} onClick={() => onNavigate(plan.blockId)}>
              <RowIcon><FileScript /></RowIcon>
              <span className="min-w-0 flex-1 truncate">{plan.title}</span>
            </RowButton>
          ))}
        </Card>
      ) : null,
      model.subagents.length ? (
        <Card
          key="subagents"
          id="subagents"
          title={uiT(model.subagents.length === 1 ? "{count} subagent" : "{count} subagents", { count: model.subagents.length })}
        >
          {model.subagents.map((agent) => (
            <RowButton
              key={agent.blockId}
              disabled={!onOpenAgent}
              title={uiT("Open subagent conversation")}
              onClick={() => onOpenAgent?.(agent.blockId)}
            >
              <RowIcon
                title={uiT(
                  agent.state === "pending"
                    ? "Running"
                    : agent.state === "rejected"
                      ? "Failed"
                      : "Completed",
                )}
              >
                {agent.state === "pending" ? (
                  <TerminalSpinner className="grid size-4 shrink-0 place-items-center text-[11px] leading-none select-none" />
                ) : agent.state === "rejected" ? (
                  <CircleAlert className="text-red-400" />
                ) : (
                  <Check />
                )}
              </RowIcon>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {agent.model ? (
                <span className="min-w-0 max-w-[35%] truncate font-mono text-[10px] text-content/40" title={agent.model}>
                  {agent.model}
                </span>
              ) : null}
              <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-content/40">
                {uiT(agent.steps === 1 ? "{count} step" : "{count} steps", { count: agent.steps })}
              </span>
            </RowButton>
          ))}
        </Card>
      ) : null,
      backgroundContent ? (
        <Card key="background" id="background" title={uiT("Background tasks")}>
          {backgroundContent}
        </Card>
      ) : null,
      context && percent !== null ? (
        <Card
          key="context"
          id="context"
          title={uiT("Context")}
          defaultFolded
          meta={
            <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-content/55">
              {percent}%
              <ContextBar percent={percent} />
            </span>
          }
        >
          <ContextUsageDetails usage={context} />
        </Card>
      ) : null,
      usage && hasSessionUsage(usage) ? (
        <UsageCard
          key="usage"
          id="usage"
          session={usage}
          project={cwd}
          onSelectAccount={(provider, accountId) => {
            if (usage.id) actions?.selectProviderAccount?.(usage.id, provider, accountId);
          }}
          onManageAccounts={actions?.manageProviderAccounts}
        />
      ) : null,
  ].filter((card) => card !== null);
  const present = cards.map((card) => card.props.id);
  const visible = order.filter((id) => present.includes(id));
  const sortable = useAnimatedReorder(visible, (next) => {
    const merged = mergeOrderedSubset(order.map((id) => ({ id })), next.map((id) => ({ id }))).map(({ id }) => id);
    setOrder(merged);
    saveStatusCardOrder(merged);
  }, "y");
  useListReorderMotion(list, visible, "data-status-card", !sortable.draggingId);
  const reorder = useMemo<CardReorder>(() => ({
    setItemRef: sortable.setItemRef,
    onHandlePointerDown: sortable.onItemPointerDown,
    draggingId: sortable.draggingId,
    movable: visible.length > 1,
  }), [sortable.setItemRef, sortable.onItemPointerDown, sortable.draggingId, visible.length]);
  return (
    <div ref={list} data-reordering={sortable.draggingId ? "" : undefined} className="flex flex-col gap-2.5">
      <CardReorderContext.Provider value={reorder}>
        {visible.map((id) => cards.find((card) => card.props.id === id))}
      </CardReorderContext.Provider>
    </div>
  );
}

function UsageCard({ id, ...props }: { id: "usage" } & React.ComponentProps<typeof ProviderUsageBar>) {
  const { t: uiT } = useTranslation();
  return (
    <ProviderUsageBar
      {...props}
      render={(controls, limits, summary) => (
        <Card id={id} title={uiT("Usage")} foldedMeta={summary ?? <UsageRemaining limits={limits} />}>
          <div data-session-usage className="flex min-w-0 flex-wrap items-center gap-1 px-2 py-1 text-[11px] text-content/55">
            {controls}
          </div>
        </Card>
      )}
    />
  );
}

function UsageRemaining({ limits }: { limits?: ProviderRateLimits }) {
  const { t: uiT } = useTranslation();
  const now = useUsageClock();
  const shortest = [limits?.session, limits?.weekly, limits?.monthly]
    .filter((window) => window != null)
    .sort((a, b) => a.windowMinutes - b.windowMinutes)[0];
  const remaining = shortest
    ? shortest.resetsAt != null && shortest.resetsAt <= now
      ? 100
      : 100 - clampUsedPercent(shortest.usedPercent)
    : null;
  const window = shortest ? formatWindowLabel(shortest.windowMinutes) : null;
  const loading = limits?.status === "idle" || limits?.status === "fetching";
  const tone = remaining !== null && remaining <= 0
    ? "text-red-400"
    : remaining !== null && remaining <= LOW_HEADROOM_PERCENT
      ? "text-amber-500"
      : "text-content/55";
  return (
    <span
      data-session-usage-remaining
      className={`min-w-0 truncate text-[11px] tabular-nums ${tone}`}
      title={remaining !== null ? uiT("Shortest usage window") : undefined}
    >
      {remaining !== null
        ? uiT(
            window === "wk" ? "Weekly remaining {percent}" : window === "mo" ? "Monthly remaining {percent}" : "{window} remaining {percent}",
            { window: window ?? "", percent: formatUsagePercent(remaining) },
          )
        : uiT(loading ? "Checking…" : "Usage unavailable")}
    </span>
  );
}

/** The folder as its machine sees it. */
function environmentPath(cwd: string): string {
  return parseRemotePath(cwd)?.hostPath ?? cwd;
}

function EnvironmentRows({ cwd, branch }: { cwd: string; branch?: string }) {
  const { t: uiT } = useTranslation();
  const { machines } = useRemoteMachines();
  const remote = parseRemotePath(cwd);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : machines.find(isSharedHostMachine);
  const localComputerName = !remote ? machine?.name.trim() : undefined;
  const machineName = !remote
    ? [uiT("This machine"), localComputerName].filter(Boolean).join(" · ")
    : machine?.wsl
      ? `WSL · ${machine.wsl.distribution}`
      : machine?.name ?? uiT("Remote");
  const path = environmentPath(cwd);
  const parent = prettyParent(path);
  return (
    <>
      <Row title={machineName} wrap>
        <RowIcon>{remote ? <Internet /> : <Laptop />}</RowIcon>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {!remote ? <>
            {uiT("This machine")}
            {localComputerName ? <span className="text-content/45"> · {localComputerName}</span> : null}
          </> : machineName}
        </span>
      </Row>
      {/* The full folder wraps rather than truncating; the icon stays on its first line. */}
      <Row title={path} wrap>
        <RowIcon><Folder /></RowIcon>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {projectName(path)}
          {parent && parent !== path ? (
            <span className="text-content/45"> · {parent}</span>
          ) : null}
        </span>
      </Row>
      {branch ? (
        <Row title={branch} wrap>
          <RowIcon><GitBranch /></RowIcon>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{branch}</span>
        </Row>
      ) : null}
    </>
  );
}

/** Usage level: blue while there is room, then the context ring's amber and red warnings. */
function ContextBar({ percent }: { percent: number }) {
  const tone =
    percent >= 90 ? "bg-red-400" : percent >= 75 ? "bg-amber-400" : "bg-blue-500";
  return (
    <span aria-hidden="true" className="relative h-1.5 w-7 overflow-hidden rounded-full bg-content/12">
      <span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${percent}%` }} />
    </span>
  );
}

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex min-w-0 flex-1 items-baseline gap-2 font-mono text-[12px] font-medium tabular-nums">
      <span className="text-emerald-500">+{additions.toLocaleString()}</span>
      <span className="text-rose-500">−{deletions.toLocaleString()}</span>
    </span>
  );
}

function TaskRows({ items }: { items: SessionStatusPanelModel["tasks"] }) {
  return (
    <>
      {(items ?? []).map((item, index) => (
        <li
          key={item.id ?? `${index}:${item.text}`}
          data-status-task
          className="flex min-w-0 items-start gap-2.5 px-2 py-1"
        >
          <span className="grid size-4 shrink-0 place-items-center [&>span]:mt-0">
            <TaskState status={item.status} />
          </span>
          <span
            className={`min-w-0 flex-1 text-[12.5px] leading-4 ${
              item.status === "completed" || item.status === "cancelled"
                ? "text-content/40 line-through decoration-content/25"
                : item.status === "in_progress"
                  ? "text-content/85"
                  : "text-content/60"
            }`}
          >
            {item.text}
          </span>
        </li>
      ))}
    </>
  );
}

type CardReorder = {
  setItemRef: (id: StatusCardId, node: HTMLElement | null) => void;
  onHandlePointerDown: (id: StatusCardId, event: ReactPointerEvent) => void;
  draggingId: StatusCardId | null;
  movable: boolean;
};
const CardReorderContext = createContext<CardReorder | null>(null);

function Card({
  id,
  title,
  meta,
  foldedMeta,
  defaultFolded = false,
  children,
}: {
  id: StatusCardId;
  title: string;
  meta?: ReactNode;
  /** Summary shown in the header only while the card is folded. */
  foldedMeta?: ReactNode;
  defaultFolded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() =>
    defaultFolded ? foldedCards.has(`${id}:open`) : !foldedCards.has(id),
  );
  const toggle = () => {
    const next = !expanded;
    if (defaultFolded) {
      if (next) foldedCards.add(`${id}:open`);
      else foldedCards.delete(`${id}:open`);
    } else if (next) foldedCards.delete(id);
    else foldedCards.add(id);
    setExpanded(next);
  };
  const { t: uiT } = useTranslation();
  const reorder = useContext(CardReorderContext);
  const dragging = reorder?.draggingId === id;
  return (
    <section
      ref={(node) => reorder?.setItemRef(id, node)}
      data-status-card={id}
      data-dragging={dragging || undefined}
      className={`shrink-0 overflow-hidden rounded-xl border border-content/10 bg-card text-content ${dragging ? "relative z-10 shadow-lg" : "shadow-sm"}`}
    >
      <div className="group/status-card relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex h-9 w-full min-w-0 items-center gap-1.5 px-3.5 text-left"
      >
        <h3 className="max-w-[70%] shrink-0 truncate text-[13px] leading-4 font-medium text-content/85">
          {title}
        </h3>
        <DisclosureChevron
          expanded={expanded}
          className="size-3 shrink-0 text-content/45"
        />
        <span className="flex-1" />
        {/* The drag handle takes the summary's place while the header is hovered. */}
        <span className={`flex min-w-0 items-center gap-2 transition-opacity duration-150 motion-reduce:transition-none${reorder?.movable ? " group-hover/status-card:opacity-0" : ""}${dragging ? " opacity-0" : ""}`}>
          {!expanded && foldedMeta ? foldedMeta : null}
          {meta ? (
            typeof meta === "string" ? (
              <span className="shrink-0 font-mono text-[11px] text-content/50">{meta}</span>
            ) : (
              meta
            )
          ) : null}
        </span>
      </button>
      {reorder?.movable ? (
        <button
          type="button"
          data-status-card-handle
          title={uiT("Drag to move")}
          aria-label={uiT("Drag to move")}
          onPointerDown={(event) => reorder.onHandlePointerDown(id, event)}
          className={`absolute top-1/2 right-2 grid size-6 -translate-y-1/2 touch-none cursor-grab place-items-center rounded-md text-content/45 transition-opacity duration-150 hover:bg-content/5 hover:text-content/75 active:cursor-grabbing motion-reduce:transition-none group-hover/status-card:opacity-100 focus-visible:opacity-100${dragging ? " opacity-100" : " opacity-0"}`}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : null}
      </div>
      <AnimatedCollapse expanded={expanded} motion="height">
        <div className="px-1.5 pb-2">{children}</div>
      </AnimatedCollapse>
    </section>
  );
}

function RowIcon({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="grid size-4 shrink-0 place-items-center text-content/55 [&>svg]:size-4">
      {children}
    </span>
  );
}

const rowBaseClassName =
  "flex w-full min-w-0 gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] leading-4 text-content/80";
const rowClassName = `${rowBaseClassName} items-center`;

function Row({ children, title, wrap = false }: { children: ReactNode; title?: string; wrap?: boolean }) {
  return (
    <div data-status-row title={title} className={wrap ? `${rowBaseClassName} items-start` : rowClassName}>
      {children}
    </div>
  );
}

function RowButton({
  onClick,
  disabled,
  children,
  ...rest
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "title">) {
  return (
    <button
      type="button"
      data-status-row
      disabled={disabled}
      onClick={onClick}
      className={`${rowClassName} enabled:hover:bg-content/5 enabled:hover:text-content disabled:cursor-default`}
      {...rest}
    >
      {children}
    </button>
  );
}
