import { cn } from "../../../../shared/lib/cn";
import { AssistantStatus } from "../../../../shared/ui/messaging/AssistantStatus";
import { AnimatePresence, motion } from "motion/react";
import { msgTransition, immediateTransition } from "../../../../shared/motion/tokens";
import { useMotionPreference } from "../../../../shared/motion/useMotionPreference";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { ProjectMascot } from "../../../projects/ui/ProjectMascot";
import { useProjectMascotAppearance } from "../../../projects/ui/useProjectMascotAppearance";
import { liveStatus } from "../../model/liveStatus";
import { Shimmer } from "../../../../shared/ui/Shimmer";
import { TypingDots } from "../../../../shared/ui/TypingDots";
import { RollingClock, rollingClockMotion } from "../../../../shared/ui/RollingClock";
import { type Block, type SessionExecutionState } from "../../model/session";
import { ActivityPhaseIcon } from "./activity/ActivityPhaseIcon";
import { formatElapsed, formatWorkingDuration, useElapsedFrom, useNow } from "./transcriptClock";
import { startupLabels, startupProgressText } from "../../model/startupStatus";
import { parseStartupProgress } from "../../../../integrations/harness/core/startupProgress";



function executionLabel(state?: SessionExecutionState): string | undefined {
  switch (state?.phase) {
    case "waiting-resource": return state.reason === "computer" ? "Waiting for computer access…" : state.reason === "removing" ? "Waiting for worktree cleanup…" : "Waiting for workspace changes to finish…";
    case "starting": {
      const startup = parseStartupProgress(state.startup);
      return startup ? startupLabels[startup.stage] : "Preparing to start…";
    }
    case "awaiting-response": return "Waiting for model response…";
    case "settling": return "Finishing up…";
    default: return undefined;
  }
}
function executionDetails(state?: SessionExecutionState): string | undefined {
  return state?.blockers?.map(b => `${b.id} · PID ${b.ownerPid} · ${b.path}`).join("\n");
}

/** Placeholder for private reasoning before the first assistant text arrives. */
export function InitialThinking({
  executionState,
  live,
  embedded = false,
}: {
  live: boolean;
  executionState?: SessionExecutionState;
  embedded?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const progress = executionState?.phase === "starting" ? startupProgressText(executionState.startup, uiT) : undefined;
  const text = `${uiT(executionLabel(executionState) ?? "Thinking…")}${progress ? ` · ${progress}` : ""}`;
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5 pt-3 pb-1 font-sans text-sm text-content/50", embedded ? "" : "px-4 @md:px-6")}
    >
      <ActivityPhaseIcon kind="think" />
      {live ? (
        <Shimmer duration={1.6}>{text}</Shimmer>
      ) : (
        text
      )}
    </div>
  );
}

/**
 * The clock on a turn's fold line: how long the agent has been at it, or what
 * it is waiting on.
 */
export function LiveFoldTitle({
  startedAt,
  executionState,
  paused,
  waitingLabel,
  background,
  modelName,
  clockHidden = false,
  responding = false,
}: {
  startedAt?: number;
  executionState?: SessionExecutionState;
  paused: boolean;
  /** The agent has produced output this turn; the typing dots only cover the wait before it. */
  responding?: boolean;
  waitingLabel?: string;
  background?: string[];
  modelName?: string;
  /** The client shows an activity clock (and the typing dots) under the live turn. */
  clockHidden?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const phaseLabel = executionLabel(executionState);
  const progress = executionState?.phase === "starting" ? startupProgressText(executionState.startup, uiT) : undefined;
  const elapsedMs = useElapsedFrom(phaseLabel ? executionState?.since : executionState?.providerStartedAt ?? startedAt, paused);
  const elapsed = formatElapsed(elapsedMs);
  // The footer's clock tracks the current activity; the fold line keeps the
  // turn's total beside the model name.
  const working = clockHidden
    ? elapsed
      ? `${formatWorkingDuration(null, modelName)} · ${elapsed}`
      : formatWorkingDuration(null, modelName)
    : formatWorkingDuration(elapsedMs, modelName);
  // Yielding with a command still going is not the end of the turn. The clock
  // keeps running and the line says what it is waiting on.
  const text = paused
    ? (waitingLabel ?? "Waiting for approval")
    : phaseLabel
      ? `${uiT(phaseLabel)}${progress ? ` · ${progress}` : ""}${elapsed ? ` · ${elapsed}` : ""}`
    : background?.length
      ? `${working} · ${backgroundLabel(background)}`
      : working;
  const label = (
    <>
      {paused || responding || clockHidden ? null : <TypingDots className="transcript-typing mr-2 shrink-0" />}
      <span className="transcript-live-fold-title min-w-0 truncate font-sans text-sm text-content/50">
        {text}
      </span>
    </>
  );
  return (
    <span className="flex min-w-0" title={executionDetails(executionState) ?? background?.join("\n")}>
      {label}
    </span>
  );
}

/**
 * What sits under the reply while it is being written, for clients that keep
 * the live clock in view there: the project's mascot and one status line that
 * follows the current activity, occasionally accompanied by its clock.
 */
export function LiveTurnFooter({
  cwd,
  turn,
  seed,
  startedAt,
  executionState,
  waiting,
  background,
}: {
  cwd: string;
  turn: Block[];
  seed: string;
  startedAt?: number;
  executionState?: SessionExecutionState;
  waiting?: "approval" | "answers";
  background?: string[];
}) {
  const { t: uiT } = useTranslation();
  const reduced = useMotionPreference();
  const paused = !!waiting;
  const now = useNow();
  const mascot = useProjectMascotAppearance(cwd);
  const phaseLabel = !waiting ? executionLabel(executionState) : undefined;
  const status = liveStatus({
    turn,
    now,
    startedAt: executionState?.providerStartedAt ?? startedAt,
    waiting,
    background: background?.length,
    seed,
  });
  const startup = !status.starting && executionState?.phase === "starting" && !waiting ? parseStartupProgress(executionState.startup) : undefined;
  const progress = startupProgressText(startup, uiT);
  if (phaseLabel && executionState) {
    status.phase = executionState.phase === "waiting-resource" ? "waiting" : "working";
    status.clock = "round";
    status.label = { literal: `${uiT(phaseLabel)}${progress ? ` · ${progress}` : ""}` };
    status.clockStartedAt = executionState.since;
    status.elapsed = formatElapsed(Math.max(0, now - executionState.since)) ?? undefined;
    status.showClock = true;
  }
  const label =
    "literal" in status.label
      ? status.label.literal
      : uiT(status.label.key, status.label.params);
  const verb = status.phase === "tool" ? `${label}…` : label;
  // Startup details are already shown above the footer.
  const typing = status.starting && !paused;
  return (
    <AssistantStatus
      icon={
        <ProjectMascot
          project={mascot.project}
          name={mascot.name}
          color={mascot.color}
          active={!paused}
          className="size-4 shrink-0"
        />
      }
      className="transcript-live-footer"
      title={executionDetails(executionState)}
      data-live-footer
      data-live-phase={status.phase}
      data-live-clock={status.showClock && !typing ? status.clock : undefined}
    >
      <span className="flex min-w-0 items-center gap-1">
        {status.showClock && status.elapsed && !typing ? (
          <>
            <RollingClock
              key={`${status.clock}:${status.clockStartedAt}`}
              value={status.elapsed}
              motion={rollingClockMotion(`${seed}:${status.clock}`, status.clockStartedAt ?? 0)}
            />
            <span className="shrink-0 text-content/40" aria-hidden="true">{" · "}</span>
          </>
        ) : null}
        {/* Phase copy can ease in without remounting the ticking digits. */}
        <AnimatePresence mode="popLayout"><motion.span key={typing ? "starting" : `${status.phase}:${startup?.stage ?? label}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? immediateTransition : msgTransition} className="transcript-live-status flex min-w-0 items-center"
          role={startup ? "progressbar" : undefined} aria-label={startup && phaseLabel ? uiT(phaseLabel) : undefined}
          aria-valuemin={startup ? 0 : undefined} aria-valuemax={startup?.total} aria-valuenow={startup?.total ? startup.completed : undefined}
          aria-valuetext={startup ? verb : undefined}>
          {typing ? (
            <TypingDots className="transcript-typing shrink-0" label={verb} />
          ) : (
            <Shimmer className={cn("min-w-0", startup ? "whitespace-normal break-words" : "truncate")} duration={1.6}>
              {verb}
            </Shimmer>
          )}
        </motion.span></AnimatePresence>
      </span>
      {status.background ? (
        <span
          className="shrink-0 truncate text-accent"
          title={background?.join("\n")}
        >
          {`· ${uiT(
            status.background === 1 ? "{count} running task" : "{count} running tasks",
            { count: status.background },
          )}`}
        </span>
      ) : null}
    </AssistantStatus>
  );
}

function backgroundLabel(tasks: string[]): string {
  return tasks.length === 1
    ? "running in background"
    : `${tasks.length} tasks running in background`;
}
