import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useModelSource } from "../../sessions/ui/modelSource";
import {
  orchestrationTaskLabel,
  type OrchestrationSummary,
} from "../model/orchestrationSummary";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  OrchestrationActions,
  OrchestrationWorkers,
  OrchestrationRuntimeContext,
} from "./OrchestrationActions";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
} from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import { localizeOrchestrationMessage } from "./orchestrationMessages";

export function OrchestrationSidebarAgents({
  leadId,
  summary,
  showRunActions = true,
}: {
  leadId: string;
  summary: OrchestrationSummary;
  showRunActions?: boolean;
}) {
  const { t: uiT } = useTranslation();
  const modelSource = useModelSource();
  const suppliedActions = useContext(OrchestrationActions);
  const actions = suppliedActions?.canControl === false ? null : suppliedActions;
  const workers = useContext(OrchestrationWorkers);
  const runtime = useContext(OrchestrationRuntimeContext);
  const runs = useSyncExternalStore(
    runtime.subscribe,
    runtime.snapshot,
    runtime.snapshot,
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // Rows expand independently, so several agents can be watched side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Revealing a worker from its toast opens that row without closing others.
  const revealed = workers.selectedId;
  useEffect(() => {
    if (revealed)
      setExpanded((current) =>
        current.has(revealed) ? current : new Set(current).add(revealed),
      );
  }, [revealed]);
  const toggle = (sessionId: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    if (isOpen && revealed === sessionId) workers.inspect(null);
  };
  // A saved run has no live entry, so the card stays read-only after a reload.
  const run = runs.find((entry) => entry.leadId === leadId);
  const stopping = !!run?.tasks.some(
    (task) => task.status === "running" || task.status === "cancelling",
  );
  const resumeBlocker =
    run?.status === "paused" ? runtime.resumeBlocker(leadId) : undefined;
  const leadBusy =
    run?.status === "paused" && runtime.resumeLeadBusy(leadId);
  const perform = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  const done = summary.tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const action =
    "rounded px-1.5 py-0.5 text-[11px] text-content/55 hover:bg-content/6 hover:text-content disabled:opacity-35";
  // Sits inside an already-lit row, so it needs its own surface to read as a
  // button rather than as another line of text.
  const solidAction =
    "rounded bg-content/15 px-1.5 py-0.5 text-[11px] text-content/75 hover:bg-content/25 hover:text-content disabled:opacity-35";
  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 px-0.5 flex items-center justify-between text-[11px] text-content/45">
        <span>
          {summary.tasks.length}{" "}
          {summary.tasks.length === 1 ? uiT("agent") : uiT("agents")}
        </span>
        <span className="tabular-nums">
          {done}/{summary.tasks.length} {uiT("done")}
        </span>
      </div>
      {/*
        Offset by the rows' own padding so a chevron lands on the card's
        content edge, under the harness icon of the header above.

        No height cap and no scroller: the card grows with whatever the user
        expanded, and the sidebar it sits in does the only scrolling. Nesting
        a second scroll region here made rows clip mid-line.
      */}
      <div
        aria-label={uiT("Orchestrated agents")}
        className="-mx-2 flex touch-pan-y flex-col gap-px"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {summary.tasks.map((task) => {
          // Something waiting on an answer opens itself; it cannot be missed.
          const open = expanded.has(task.sessionId) || !!task.needsInput;
          const live = run?.tasks.find(
            (entry) => entry.sessionId === task.sessionId,
          );
          const label = orchestrationTaskLabel(task, summary);
          const working =
            summary.live && task.status === "running" && !task.needsInput;
          // A saved provider model may not be in this window's catalog yet.
          // Keep its identity instead of substituting the harness default.
          const model = modelSource.find(task.model)?.name ?? task.model;
          return (
            <div
              key={task.sessionId}
              data-orchestration-agent={task.sessionId}
              // Expanding lights the whole row, header and detail together.
              className={`rounded-md ${open ? "bg-selection" : ""}`}
            >
              <button
                type="button"
                title={`${task.title} · ${HARNESS_TITLE[task.harness]} · ${model} · ${label}`}
                aria-label={uiT("Agent details: {value0}", {
                  value0: String(task.title),
                })}
                aria-expanded={open}
                onClick={() => toggle(task.sessionId, open)}
                // Named, because the whole session card is already a `group`.
                className={`group/agent flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left ${
                  open ? "" : "hover:bg-content/6"
                }`}
              >
                {/* One slot: the chevron stands in for the harness mark
                    whenever this row is open or under the pointer. */}
                <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
                  {open ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <>
                      <HarnessIcon
                        harness={task.harness}
                        className="size-3.5 opacity-75 group-focus-visible/agent:hidden group-hover/agent:hidden"
                      />
                      <ChevronRight
                        className="hidden size-3 group-focus-visible/agent:block group-hover/agent:block"
                      />
                    </>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-content/80">
                  {task.title}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[11px] ${
                    task.needsInput ||
                    task.status === "failed" ||
                    task.status === "blocked" ||
                    task.status === "interrupted"
                      ? "text-amber-400"
                      : working
                        ? "text-accent"
                        : task.status === "completed"
                          ? "text-emerald-400"
                          : "text-content/45"
                  }`}
                >
                  {task.needsInput ||
                  task.status === "failed" ||
                  task.status === "blocked" ||
                  task.status === "interrupted" ? (
                    <CircleAlert className="size-3" />
                  ) : working ? (
                    <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
                  ) : task.status === "completed" ? (
                    <Check className="size-3" strokeWidth={2.25} />
                  ) : null}
                  <span>{label}</span>
                </span>
              </button>
              {/* Indented to the title's column: the icon slot and its gap. */}
              {open && (
                <div className="space-y-2 pb-3 pl-6.5 pr-2">
                  <p
                    className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/45"
                    title={`${model} · ${HARNESS_TITLE[task.harness]}`}
                  >
                    <HarnessIcon
                      harness={task.harness}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 truncate">{model}</span>
                  </p>
                  {live?.error && (
                    <p className="text-[11px] text-red-400">{localizeOrchestrationMessage(live.error, uiT)}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {workers.openDetails && (
                      <button
                        type="button"
                        title={uiT("Open this agent beside the orchestrator")}
                        className={solidAction}
                        onClick={() =>
                          workers.openDetails?.({
                            sessionId: task.sessionId,
                            leadId,
                            title: task.title,
                            harness: task.harness,
                          })
                        }
                      >
                        {uiT("See details")}
                      </button>
                    )}
                    {actions && live && ["queued", "running"].includes(live.status) && (
                      <button
                        type="button"
                        className={solidAction}
                        disabled={pending}
                        onClick={() =>
                          void perform(() =>
                            runtime.cancelTask(leadId, live.id),
                          )
                        }
                      >
                        {uiT("Cancel task")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(error || run?.error) && (
        <p role="alert" className="py-1 text-[11px] text-red-400">
          {localizeOrchestrationMessage(error ?? run?.error ?? "", uiT)}
        </p>
      )}
      {/* Stopping a run belongs to the composer, which stops the lead and its
          agents together. Resume has no other home, so it stays. */}
      {showRunActions && run?.status === "paused" && (
        <div className="mt-1.5 space-y-1.5 border-t border-stroke pt-1.5">
          <p className="px-0.5 text-[11px] leading-relaxed text-content/45">
            {stopping
              ? uiT("Stopping interrupted work before this run can resume.")
              : leadBusy
                ? uiT(
                    "Waiting for the lead's interrupted turn to finish before this run can resume.",
                  )
                : uiT(
                    "Resume continues interrupted workers from their retained checkouts and starts queued work. Policy-blocked tasks stay stopped for review.",
                  )}
          </p>
          {resumeBlocker && (
            <p className="px-0.5 text-[11px] leading-relaxed text-amber-400">
              {resumeBlocker.title || uiT("Another conversation")}{" "}
              {uiT("is still running in this project.")}
            </p>
          )}
          <div className="-mr-1.5 flex items-center justify-end gap-1">
            {resumeBlocker && actions && (
              <button
                type="button"
                className={action}
                disabled={pending}
                onClick={() => actions.open(resumeBlocker.id)}
              >
                {uiT("Open blocker")}
              </button>
            )}
            <button
              type="button"
              className={action}
              disabled={pending || stopping || leadBusy || !!resumeBlocker}
              title={
                stopping
                  ? uiT("Wait for interrupted agents to stop")
                  : leadBusy
                    ? uiT("Wait for the lead's interrupted turn to finish")
                    : resumeBlocker
                      ? uiT("Stop {value0} before resuming", {
                          value0: String(
                            resumeBlocker.title || "the other conversation",
                          ),
                        })
                      : uiT("Continue interrupted and queued work")
              }
              onClick={() =>
                void perform(() =>
                  runtime.resume(leadId),
                )
              }
            >
              {uiT("Resume")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
