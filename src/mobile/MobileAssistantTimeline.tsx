import { useState } from "react";
import type { BotTimelineProps } from "../features/bots/ui/BotChatChrome";
import type { BotTask } from "../integrations/harness/core/botAutonomy";
import { useTranslation } from "../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { Button } from "../shared/ui/forms/Button";
import { MobileSheet, MobileSheetHeader } from "./MobileSheet";

const statuses: Record<BotTask["status"], string> = {
  accepted: "Accepted",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  unknown: "Needs review",
  unavailable: "Unavailable",
  approval: "Waiting for approval",
  question: "Waiting for an answer",
  stopped: "Stopped",
};
function Task({
  task,
  onViewSession,
}: Pick<BotTimelineProps, "onViewSession"> & { task: BotTask }) {
  const { t } = useTranslation();
  const [filesOpen, setFilesOpen] = useState(false);
  return (
    <article className="mobile-assistant-task">
      <h3>{task.projectName}</h3>
      <time>{new Date(task.startedAt).toLocaleString()}</time>
      {task.request && <p>{task.request.slice(0, 500)}</p>}
      <p role="status">
        {t(statuses[task.status])}
        {" · "}
        <time>{new Date(task.activityAt).toLocaleString()}</time>
      </p>
      {task.error && <p>{task.error}</p>}
      {task.worktree && (
        <p>
          {t(
            task.worktree.state === "merged"
              ? "Changes integrated"
              : task.worktree.state === "removed"
                ? "Completed workspace reclaimed"
                : task.worktree.state === "integrating"
                  ? "Integrating changes"
                  : task.worktree.state === "blocked"
                    ? "Work preserved for review"
                    : "Working in an isolated workspace",
          )}
          {" · "}
          {task.worktree.targetBranch}
          {task.worktree.error && (
            <span>
              {" · "}
              {t(task.worktree.error)}
            </span>
          )}
        </p>
      )}
      {(task.changes || task.commit) && (
        <small>
          {t(
            task.snapshot === "task"
              ? "Verified task changes"
              : "Current working copy snapshot",
          )}
        </small>
      )}
      {task.changes ? (
        <>
          <Button
            variant="ghost"
            onClick={() => setFilesOpen((open) => !open)}
            aria-expanded={filesOpen}
          >
            {t("{count} changed files", { count: task.changes.files.length })} ·
            +{task.changes.additions} / −{task.changes.deletions}
          </Button>
          <AnimatedCollapse expanded={filesOpen}>
            <ul>
              {task.changes.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </AnimatedCollapse>
        </>
      ) : (
        <p>{t("No recorded file changes")}</p>
      )}
      <p>
        {task.commit ? (
          <>
            {task.commit.hash.slice(0, 8)} · {task.commit.message} ·{" "}
            {t(task.commit.pushed ? "Pushed" : "Push not confirmed")}
          </>
        ) : (
          t("No recorded commit")
        )}
      </p>
      <ol>
        {task.events.map((event) => (
          <li key={event.id}>
            <time>{new Date(event.at).toLocaleTimeString()}</time>
            {" · "}
            {t(
              event.action === "sessions.create"
                ? "Work started"
                : event.action.startsWith("git.")
                  ? "Git activity"
                  : event.action.startsWith("files.")
                    ? "File activity"
                    : "Work updated",
            )}
            {" · "}
            {t(
              event.state === "executing"
                ? "Running"
                : event.state === "unknown"
                  ? "Needs review"
                  : event.state === "accepted"
                    ? "Accepted"
                    : event.state === "failed"
                      ? "Failed"
                      : "Completed",
            )}
            {event.error && <p>{event.error}</p>}
          </li>
        ))}
      </ol>
      {task.status !== "unavailable" && (
        <footer>
          <small>{t("Advanced")}</small>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewSession(task.ref)}
          >
            {t("View in conversation")}
          </Button>
        </footer>
      )}
    </article>
  );
}

export function MobileAssistantTimeline({
  open,
  tasks,
  loading,
  error,
  hasMore,
  onMore,
  onClose,
  onViewSession,
}: BotTimelineProps) {
  const { t } = useTranslation();
  return (
    <MobileSheet open={open} title="Work history" onClose={onClose}>
      <MobileSheetHeader title={t("Work history")} onClose={onClose} />
      <div className="mobile-assistant-timeline">
        {tasks.map((task) => (
          <Task key={task.id} task={task} onViewSession={onViewSession} />
        ))}
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">{t("Loading…")}</p>
        ) : (
          !tasks.length && !error && <p>{t("No work recorded yet")}</p>
        )}
        {hasMore && (
          <Button variant="ghost" disabled={loading} onClick={onMore}>
            {t("Load more")}
          </Button>
        )}
      </div>
    </MobileSheet>
  );
}
