import { Button } from "../../../shared/ui/forms/Button";
import { motion, useIsPresent } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useListReorderMotion } from "../../../shared/hooks/useListReorderMotion";
import { immediateTransition, panelTransition, popAnimate, popExit, popInitial } from "../../../shared/motion/tokens";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Check, CircleAlert, Maximize2, Square, Terminal, Trash2, X } from "../../../shared/ui/icons";
import type { BackgroundTaskItem } from "../model/backgroundTasks";
import { formatElapsed, useElapsedFrom } from "./transcript/transcriptClock";

type StopTask = (taskId: string) => Promise<void>;

export function BackgroundTasksSummary({ tasks, onOpen, onStop }: {
  tasks: BackgroundTaskItem[];
  onOpen: (id?: string) => void;
  onStop?: StopTask;
}) {
  const { t } = useTranslation();
  const running = tasks.filter((task) => task.state === "running");
  const finished = tasks.length - running.length;
  return <div data-background-summary>
    {running.slice(0, 3).map((task) => <div key={task.id} className="background-task-row">
      <Button variant="ghost" size="content" type="button" className="background-task-open" onClick={() => onOpen(task.id)} title={task.title}>
        <Terminal className="size-3.5 shrink-0 text-content/50" />
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <TaskElapsed task={task} />
      </Button>
      {task.taskId && onStop ? <StopTaskButton taskId={task.taskId} onStop={onStop} /> : null}
    </div>)}
    {finished || running.length > 3 ? <Button variant="ghost" size="content" type="button" className="background-task-open" onClick={() => onOpen()}>
      <Check className="size-3.5 shrink-0 text-content/50" />
      {finished ? t("{count} finished", { count: finished }) : t("{count} running", { count: running.length })}
    </Button> : null}
  </div>;
}

export function BackgroundTasksPanel({ tasks, initialTaskId, onClose, onClear, onStop }: {
  tasks: BackgroundTaskItem[];
  initialTaskId?: string;
  onClose: () => void;
  onClear: () => void;
  onStop?: StopTask;
}) {
  const { t } = useTranslation();
  const reduced = useMotionPreference();
  const present = useIsPresent();
  const titleId = useId();
  const [wide, setWide] = useState(false);
  const [finishedOpen, setFinishedOpen] = useState(true);
  const [limit, setLimit] = useState(10);
  const [expanded, setExpanded] = useState(() => new Set(initialTaskId ? [initialTaskId] : []));
  const close = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const running = tasks.filter((task) => task.state === "running");
  const finished = tasks.filter((task) => task.state !== "running");
  useListReorderMotion(list, [...running, ...finished.slice(0, limit)].map((task) => task.id), "data-background-task", present, `${finishedOpen}:${limit}`);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const row = (task: BackgroundTaskItem) => <TaskRow key={task.id} task={task} expanded={expanded.has(task.id)}
    onToggle={() => toggle(task.id)} onStop={onStop} />;
  return <motion.aside
    data-background-tasks-panel data-wide={wide || undefined}
    role="complementary" aria-labelledby={titleId}
    initial={reduced ? false : popInitial} animate={popAnimate} exit={popExit}
    transition={reduced ? immediateTransition : panelTransition}
    inert={!present} aria-hidden={!present || undefined}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
  >
    <header className="background-tasks-header">
      <h2 id={titleId} className="min-w-0 flex-1 truncate font-medium">{t("Background tasks")}</h2>
      <IconButton label={t("Clear finished tasks")} size="sm" disabled={!finished.length} onClick={onClear}><Trash2 /></IconButton>
      <IconButton label={t(wide ? "Collapse panel" : "Expand panel")} size="sm" active={wide} onClick={() => setWide((value) => !value)}><Maximize2 /></IconButton>
      <IconButton ref={close} label={t("Close")} size="sm" onClick={onClose}><X /></IconButton>
    </header>
    <div ref={list} className="background-tasks-list">
      {running.length ? <section>
        <h3 className="background-tasks-section-title">{t("Running")}</h3>
        {running.map(row)}
      </section> : null}
      {finished.length ? <section>
        <Button variant="ghost" size="content" type="button" className="background-tasks-section-title flex items-center gap-1.5" aria-expanded={finishedOpen}
          onClick={() => setFinishedOpen((value) => !value)}>
          {t("Finished {count}", { count: finished.length })}<DisclosureChevron expanded={finishedOpen} className="size-3" />
        </Button>
        <AnimatedCollapse expanded={finishedOpen}>
          {finished.slice(0, limit).map(row)}
          {finished.length > 10 ? <Button variant="ghost" size="content" type="button" className="background-task-open text-content/50"
            onClick={() => setLimit((value) => value < finished.length ? value + 10 : 10)}>
            {t(limit < finished.length ? "Show more" : "Show fewer")}
          </Button> : null}
        </AnimatedCollapse>
      </section> : null}
      {!tasks.length ? <p className="p-3 text-content/50">{t("No background tasks")}</p> : null}
    </div>
  </motion.aside>;
}

function TaskRow({ task, expanded, onToggle, onStop }: {
  task: BackgroundTaskItem; expanded: boolean; onToggle: () => void; onStop?: StopTask;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const stateLabel = t(task.state === "running" ? "Running" : task.state === "failed" ? "Failed" : task.state === "stopped" ? "Stopped" : "Completed");
  return <div data-background-task={task.id}>
    <div className="background-task-row">
      <Button variant="ghost" size="content" type="button" className="background-task-open" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle} title={task.title}>
        {task.state === "failed" ? <CircleAlert className="size-3.5 shrink-0 text-red-400" aria-label={stateLabel} /> : null}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <span className="sr-only">{stateLabel}</span>
        <TaskElapsed task={task} />
        <DisclosureChevron expanded={expanded} className="size-3.5 shrink-0 text-content/45" />
      </Button>
      {task.state === "running" && task.taskId && onStop ? <StopTaskButton taskId={task.taskId} onStop={onStop} /> : null}
    </div>
    <AnimatedCollapse expanded={expanded}>
      <div id={detailsId} className="background-task-details">
        {task.command ? <pre aria-label={t("Command")} className="background-task-command"><code>$ {task.command}</code></pre> : null}
        <pre aria-label={t("Output")} className="background-task-output"><code>{task.output || t(task.state === "running" ? "Waiting for output…" : "No output recorded")}</code></pre>
        <span className="text-[11px] text-content/50">{stateLabel}</span>
      </div>
    </AnimatedCollapse>
  </div>;
}

function TaskElapsed({ task }: { task: BackgroundTaskItem }) {
  if (task.state === "running" && task.startedAt != null) return <LiveElapsed startedAt={task.startedAt} />;
  return task.durationMs != null ? <span className="background-task-elapsed">{formatElapsed(task.durationMs)}</span> : null;
}

function LiveElapsed({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedFrom(startedAt, false);
  return <span className="background-task-elapsed">{formatElapsed(elapsed)}</span>;
}

function StopTaskButton({ taskId, onStop }: { taskId: string; onStop: StopTask }) {
  const { t } = useTranslation();
  const mutation = useMutation({ mutationFn: () => onStop(taskId) }, queryClient);
  const stopping = mutation.isPending, error = mutation.isError;
  return <span className="background-task-stop">
    <IconButton label={t(error ? "Retry stopping task" : stopping ? "Stopping task…" : "Stop task")} size="xs" disabled={stopping}
      onClick={() => mutation.mutate()}><Square /></IconButton>
    {error ? <span role="alert" className="background-task-stop-error">{t("Could not stop task")}</span> : null}
  </span>;
}
