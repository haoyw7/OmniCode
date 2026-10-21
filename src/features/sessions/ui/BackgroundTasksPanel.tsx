import { Button } from "../../../shared/ui/forms/Button";
import { useIsPresent } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useEffect, useId, useState } from "react";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { clearFinishedBackgroundTasks, useBackgroundTaskPanel, visibleBackgroundTasks } from "../model/backgroundTaskPanels";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ListMotion, ListMotionItem } from "../../../shared/ui/ListMotion";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Check, CircleAlert, Square, Terminal, Trash2 } from "../../../shared/ui/icons";
import type { BackgroundTaskItem } from "../model/backgroundTasks";
import { formatElapsed, useElapsedFrom, TranscriptClockOffset } from "./transcript/transcriptClock";

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

function BackgroundTasksPanel({ tasks, initialTaskId, request, onStop }: {
  tasks: BackgroundTaskItem[];
  initialTaskId?: string;
  request?: number;
  onStop?: StopTask;
}) {
  const { t } = useTranslation();
  const present = useIsPresent();
  const [finishedOpen, setFinishedOpen] = useState(true);
  const [limit, setLimit] = useState(10);
  const [expanded, setExpanded] = useState(() => new Set(initialTaskId ? [initialTaskId] : []));
  const running = tasks.filter((task) => task.state === "running");
  const finished = tasks.filter((task) => task.state !== "running");
  useEffect(() => {
    if (initialTaskId) setExpanded(current => new Set([...current, initialTaskId]));
  }, [initialTaskId, request]);
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const row = (task: BackgroundTaskItem) => <TaskRow key={task.id} task={task} expanded={expanded.has(task.id)}
    onToggle={() => toggle(task.id)} onStop={onStop} />;
  return <aside
    data-background-tasks-panel
    role="complementary" aria-label={t("Background tasks")}
    inert={!present} aria-hidden={!present || undefined}
  >
    <div className="background-tasks-list">
      {running.length ? <section>
        <h3 className="background-tasks-section-title">{t("Running")}</h3>
        <ListMotion enabled={present}>{running.map(row)}</ListMotion>
      </section> : null}
      {finished.length ? <section>
        <Button variant="ghost" size="content" type="button" className="background-tasks-section-title flex items-center gap-1.5" aria-expanded={finishedOpen}
          onClick={() => setFinishedOpen((value) => !value)}>
          {t("Finished {count}", { count: finished.length })}<DisclosureChevron expanded={finishedOpen} className="size-3" />
        </Button>
        <AnimatedCollapse expanded={finishedOpen}>
          <ListMotion enabled={present && finishedOpen}>{finished.slice(0, limit).map(row)}</ListMotion>
          {finished.length > 10 ? <Button variant="ghost" size="content" type="button" className="background-task-open text-content/50"
            onClick={() => setLimit((value) => value < finished.length ? value + 10 : 10)}>
            {t(limit < finished.length ? "Show more" : "Show fewer")}
          </Button> : null}
        </AnimatedCollapse>
      </section> : null}
      {!tasks.length ? <p className="p-3 text-content/50">{t("No background tasks")}</p> : null}
    </div>
  </aside>;
}

function TaskRow({ task, expanded, onToggle, onStop }: {
  task: BackgroundTaskItem; expanded: boolean; onToggle: () => void; onStop?: StopTask;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const stateLabel = t(task.state === "running" ? "Running" : task.state === "failed" ? "Failed" : task.state === "stopped" ? "Stopped" : "Completed");
  return <ListMotionItem data-background-task={task.id}>
    <div className="background-task-row">
      <Button variant="ghost" size="content" type="button" className="background-task-open" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle} title={task.title}>
        {task.state === "failed" ? <CircleAlert className="size-3.5 shrink-0 text-danger" aria-label={stateLabel} /> : null}
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
  </ListMotionItem>;
}

function TaskElapsed({ task }: { task: BackgroundTaskItem }) {
  const visible = useSurfaceVisibility();
  if (task.state === "running" && task.startedAt != null) return visible ? <LiveElapsed startedAt={task.startedAt} /> : null;
  return task.durationMs != null ? <span className="background-task-elapsed">{formatElapsed(task.durationMs)}</span> : null;
}

function LiveElapsed({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedFrom(startedAt, false);
  return <span className="background-task-elapsed">{formatElapsed(elapsed)}</span>;
}

export function BackgroundTasksPane({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const state = useBackgroundTaskPanel(sessionId);
  return <SurfaceVisibilityContext.Provider value={visible}><TranscriptClockOffset.Provider value={state.clockOffsetMs}>
    <BackgroundTasksPanel tasks={visibleBackgroundTasks(state)} initialTaskId={state.selectedTaskId} request={state.request} onStop={state.onStop} />
  </TranscriptClockOffset.Provider></SurfaceVisibilityContext.Provider>;
}

export function BackgroundTasksClearButton({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const state = useBackgroundTaskPanel(sessionId);
  return <IconButton data-file-toolbar-action size="sm" label={t("Clear finished tasks")}
    disabled={!visibleBackgroundTasks(state).some(task => task.state !== "running")}
    onClick={() => clearFinishedBackgroundTasks(sessionId)}><Trash2 /></IconButton>;
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
