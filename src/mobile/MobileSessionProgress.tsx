import { motion } from "motion/react";
import { motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  focusedTaskWindow,
  sessionStatusSummary,
  type SessionStatusPanelModel,
} from "../features/sessions/model/sessionStatusPanel";
import { taskListProgressLabel } from "../features/sessions/model/taskList";
import { TaskState } from "../features/sessions/ui/TaskListPreview";
import { useTranslation } from "../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import {
  Bot,
  CircleAlert,
  ChevronRight,
  FileDiff,
  FileScript,
  Gauge,
  GitCompare,
  ListEnd,
  Terminal,
} from "../shared/ui/icons";
import { MobileSheet } from "./MobileSheet";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { MobileDiffCounts } from "./MobileDiffCounts";
const MotionChevronRight = motion.create(ChevronRight);
import type { MobileGitIndexState } from "./useMobileGitIndex";
import "./styles/session-progress.css";

/** A compact transcript summary; its sheet uses the same data as desktop. */
export function MobileSessionProgress({
  model,
  visible,
  open,
  sheetHost,
  onOpen,
  onClose,
  onNavigate,
  review,
  onReview,
  sessionReview,
  onSessionReview,
  dock,
}: {
  model: SessionStatusPanelModel;
  visible: boolean;
  open: boolean;
  sheetHost: HTMLElement | null;
  /** Composer slot beside the model picker; without it the capsule floats below the header. */
  dock?: HTMLElement | null;
  onOpen: () => void;
  onClose: () => void;
  onNavigate: (kind: "plan" | "agent", blockId: string) => void;
  review?: MobileGitIndexState;
  onReview?: () => void;
  /** Edits this conversation made, with Keep and Undo in their review. */
  sessionReview?: MobileGitIndexState;
  onSessionReview?: () => void;
}) {
  const { t } = useTranslation();
  const summaryId = useId();
  const shown =
    visible && (model.hasContent || !!review?.error || !!sessionReview || (open && !!review));
  // Keep the last summary readable until its closing animation finishes.
  const retained = useRef(model);
  if (model.hasContent) retained.current = model;
  const summaryModel = shown ? model : retained.current;
  const capsule = (
      <div className="mobile-session-progress" data-docked={dock ? true : undefined}>
        <AnimatedCollapse expanded={shown} motion="height">
          <button
            type="button"
            className="mobile-progress-capsule"
            aria-label={t("Session progress")}
            aria-describedby={summaryId}
            aria-haspopup="dialog"
            aria-expanded={open && shown}
            onClick={onOpen}
          >
            <ProgressSummary model={summaryModel} id={summaryId} />
            {summaryModel.git &&
              sessionStatusSummary(summaryModel)?.kind !== "git" && (
                <MobileDiffCounts
                  additions={summaryModel.git.additions}
                  deletions={summaryModel.git.deletions}
                />
              )}
            {summaryModel.tasks && (
              <span className="mobile-progress-count">
                {taskListProgressLabel(summaryModel.tasks, t)}
              </span>
            )}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </AnimatedCollapse>
      </div>
  );
  return (
    <>
      {dock ? createPortal(capsule, dock) : capsule}
      {sheetHost &&
        createPortal(
          <MobileSheetPresence open={shown && open}>
            <MobileSheet
              title="Session progress"
              header={{ title: t("Session progress") }}
              detents
              onClose={onClose}
            >
              <ProgressSections
                model={model}
                onNavigate={onNavigate}
                review={review}
                onReview={onReview}
                sessionReview={sessionReview}
                onSessionReview={onSessionReview}
              />
            </MobileSheet>
          </MobileSheetPresence>,
          sheetHost,
        )}
    </>
  );
}

function ProgressSummary({
  model,
  id,
}: {
  model: SessionStatusPanelModel;
  id: string;
}) {
  const { t } = useTranslation();
  const summary = sessionStatusSummary(model);
  if (!summary)
    return (
      <>
        <GitCompare size={16} aria-hidden="true" />
        <span className="mobile-progress-summary" id={id}>
          {t("Changes")}
        </span>
      </>
    );
  let icon: ReactNode;
  let text: string;
  switch (summary.kind) {
    case "task":
      icon = (
        <TaskState
          status={summary.status === "current" ? "in_progress" : "completed"}
        />
      );
      text = summary.text;
      break;
    case "plan":
      icon = <FileScript size={16} />;
      text = summary.text;
      break;
    case "running": {
      const Icon =
        summary.agents && summary.background
          ? Gauge
          : summary.agents
            ? Bot
            : Terminal;
      icon = <Icon size={16} />;
      text = t("{count} running", { count: String(summary.count) });
      break;
    }
    case "agents":
      icon = <Bot size={16} />;
      text = t(summary.count === 1 ? "{count} subagent" : "{count} subagents", { count: summary.count });
      break;
    case "progress":
      icon = <ListEnd size={16} />;
      text = `${summary.completed}/${summary.total}`;
      break;
    case "git":
      return (
        <>
          <GitCompare size={16} aria-hidden="true" />
          <span className="mobile-progress-summary" id={id}>
            {t("Changes")}{" "}
            {summary.additions || summary.deletions ? (
              <MobileDiffCounts
                additions={summary.additions}
                deletions={summary.deletions}
              />
            ) : summary.files > 0 ? (
              t(
                summary.files === 1
                  ? "{count} file changed"
                  : "{count} files changed",
                { count: summary.files },
              )
            ) : null}
          </span>
        </>
      );
  }
  return (
    <>
      <span className="mobile-progress-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mobile-progress-summary" id={id}>
        {text}
      </span>
    </>
  );
}

function ProgressSections({
  model,
  onNavigate,
  review,
  onReview,
  sessionReview,
  onSessionReview,
}: {
  model: SessionStatusPanelModel;
  onNavigate: (kind: "plan" | "agent", blockId: string) => void;
  review?: MobileGitIndexState;
  onReview?: () => void;
  sessionReview?: MobileGitIndexState;
  onSessionReview?: () => void;
}) {
  const { t } = useTranslation();
  const [moreTasks, setMoreTasks] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const tasks = model.tasks;
  const span = tasks ? focusedTaskWindow(tasks) : null;
  const folded = tasks && span ? tasks.length - (span.end - span.start) : 0;
  return (
    <div className="mobile-progress-sections">
      {sessionReview?.index && onSessionReview && (
        <Section
          icon={<FileDiff size={18} />}
          title={t("Session changes")}
          meta={t(sessionReview.index.files.length === 1 ? "{count} file changed" : "{count} files changed", {
            count: sessionReview.index.files.length,
          })}
        >
          <button
            type="button"
            className="mobile-progress-row"
            onClick={onSessionReview}
          >
            <span>
              <span className="mobile-progress-git-meta">
                <MobileDiffCounts
                  additions={sessionReview.index.additions}
                  deletions={sessionReview.index.deletions}
                />
              </span>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </Section>
      )}
      {review && onReview && (
        <Section
          icon={<GitCompare size={18} />}
          title={t("Uncommitted changes")}
        >
          <button
            type="button"
            className="mobile-progress-row"
            onClick={onReview}
          >
            <span>
              <span className="mobile-progress-git-meta">
                {review.index ? (
                  <MobileDiffCounts
                    additions={review.index.additions}
                    deletions={review.index.deletions}
                  />
                ) : (
                  t(review.loading ? "Loading changes…" : "Review changes")
                )}
              </span>
              {review.error && <small>{t("Could not load changes.")}</small>}
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </Section>
      )}
      {tasks && span && (
        <Section
          icon={<ListEnd size={18} />}
          title={t("Tasks")}
          meta={taskListProgressLabel(tasks, t)}
        >
          {folded > 0 ? (
            <>
              <AnimatedCollapse expanded={moreTasks} motion="height">
                <TaskRows items={tasks.slice(0, span.start)} />
              </AnimatedCollapse>
              <TaskRows items={tasks.slice(span.start, span.end)} />
              <AnimatedCollapse expanded={moreTasks} motion="height">
                <TaskRows items={tasks.slice(span.end)} />
              </AnimatedCollapse>
              <button
                type="button"
                className="mobile-progress-more"
                aria-expanded={moreTasks}
                onClick={() => setMoreTasks((value) => !value)}
              >
                {moreTasks
                  ? t("Show fewer")
                  : t("+{count} more", { count: String(folded) })}
              </button>
            </>
          ) : (
            <TaskRows items={tasks} />
          )}
        </Section>
      )}
      {model.plans.length > 0 && (
        <Section icon={<FileScript size={18} />} title={t("Plans")}>
          {model.plans.map((plan) => (
            <button
              key={plan.blockId}
              type="button"
              className="mobile-progress-row"
              onClick={() => onNavigate("plan", plan.blockId)}
            >
              <span>{plan.title}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </Section>
      )}
      {model.subagents.length > 0 && (
        <Section
          icon={<Bot size={18} />}
          title={t(model.subagents.length === 1 ? "{count} subagent" : "{count} subagents", { count: model.subagents.length })}
          expanded={agentsExpanded}
          onToggle={() => setAgentsExpanded((value) => !value)}
        >
          {model.subagents.map((agent) => (
            <button
              key={agent.blockId}
              type="button"
              className="mobile-progress-row"
              onClick={() => onNavigate("agent", agent.blockId)}
            >
              <span title={t(agent.state === "pending" ? "Running" : agent.state === "rejected" ? "Failed" : "Completed")}>
                {agent.state === "rejected" ? <CircleAlert size={16} className="text-red-400" />
                  : <TaskState status={agent.state === "pending" ? "in_progress" : "completed"} />}
              </span>
              <span>
                {agent.name}
                {agent.model && <small>{agent.model}</small>}
              </span>
              <small className="shrink-0 whitespace-nowrap font-mono tabular-nums">
                {t(agent.steps === 1 ? "{count} step" : "{count} steps", { count: agent.steps })}
              </small>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </Section>
      )}
      {model.background.length > 0 && (
        <Section icon={<Terminal size={18} />} title={t("Background")}>
          {model.background.map((description, index) => (
            <div
              key={`${index}:${description}`}
              className="mobile-progress-row"
            >
              <TaskState status="in_progress" />
              <span className="mobile-progress-command">{description}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function TaskRows({
  items,
}: {
  items: NonNullable<SessionStatusPanelModel["tasks"]>;
}) {
  return (
    <ol className="mobile-progress-tasks">
      {items.map((item, index) => (
        <li key={item.id ?? `${index}:${item.text}`} data-status={item.status}>
          <TaskState status={item.status} />
          <span>{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({
  icon,
  title,
  meta,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const heading = (
    <>
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
      {meta && <small>{meta}</small>}
    </>
  );
  return (
    <section className="mobile-progress-section">
      <h3>
        {onToggle ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex min-h-11 w-full items-center gap-2 text-left"
          >
            {heading}
            <MotionChevronRight size={16} aria-hidden="true" className="zen-disclosure-chevron ml-auto shrink-0" animate={{ rotate: expanded ? motionGeometry.disclosureAngle : 0 }} transition={panelTransition} />
          </button>
        ) : heading}
      </h3>
      {expanded === undefined ? children : (
        <AnimatedCollapse expanded={expanded} motion="height">
          {children}
        </AnimatedCollapse>
      )}
    </section>
  );
}
