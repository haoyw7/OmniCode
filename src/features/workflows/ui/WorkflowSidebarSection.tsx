// The left sidebar's Workflows section: conversations with workflow runs (each
// with run lines; a line opens the run's detail tab) and the saved
// workflows hub.
import { useContext, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Workflow } from "../../../shared/ui/icons";
import { projectName } from "../../../shared/lib/paths";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { isSessionWorkflowRunLive } from "../../../integrations/workflow/protocol/sessions-index-workflow-activity";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import { TaskWorkflowRunLines } from "../kit/components/workflow-run-line/TaskWorkflowRunLines";
import { useWorkflowIntl } from "../kit/i18n/IntlProvider";
import { WorkflowActivityContext, workflowActivityEntries, type WorkflowActivityEntry } from "../model/workflowActivity";
import { useWorkflowApp } from "./workflowAppContext";

export function WorkflowSidebarSection({ activeSessionId, onOpenSession, onOpenWorkflows, workflowsActive, renderHarnessIcon, runningIndicator }: {
  activeSessionId?: string;
  onOpenSession: (sessionId: string) => void;
  onOpenWorkflows: () => void;
  workflowsActive?: boolean;
  renderHarnessIcon: (harness: WorkflowActivityEntry["harness"]) => ReactNode;
  runningIndicator: ReactNode;
}) {
  const { t } = useTranslation();
  const { intl } = useWorkflowIntl();
  const app = useWorkflowApp();
  const entries = workflowActivityEntries(useContext(WorkflowActivityContext));
  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col gap-px px-2" data-workflow-sidebar>
        {entries.map((entry) => (
          <div
            key={entry.sessionId}
            data-workflow-conversation
            className={`flex min-w-0 flex-col rounded-lg px-2.5 py-1.5 hover:bg-surface-hover ${entry.sessionId === activeSessionId ? "bg-selection" : ""}`}
          >
            <button
              type="button"
              data-workflow-conversation-select
              className="min-w-0 truncate text-left text-ui-base text-content"
              onClick={() => onOpenSession(entry.sessionId)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span data-session-avatar className="shrink-0">
                  {renderHarnessIcon(entry.harness)}
                </span>
                <span className="desktop-sidebar-session-title min-w-0 flex-1 truncate">
                  {sessionDisplayTitle(entry.title, entry.harness)}
                </span>
                {entry.activity.runs.some((run) => isSessionWorkflowRunLive(run.status)) ? (
                  <span role="img" aria-label={t("Working...")} className="flex shrink-0">
                    {runningIndicator}
                  </span>
                ) : null}
              </span>
              <span data-session-project title={entry.cwd}>
                {entry.cwd === "~" ? t("Chats") : projectName(entry.cwd)}
              </span>
            </button>
            <TaskWorkflowRunLines
              activity={entry.activity}
              isActive={entry.sessionId === activeSessionId}
              intl={intl}
              {...(app ? { session: { workspacePath: entry.cwd, sessionId: entry.sessionId } } : {})}
              className="mt-0.5"
            />
          </div>
        ))}
        <button
          type="button"
          aria-current={workflowsActive ? "page" : undefined}
          onClick={onOpenWorkflows}
          className={`flex h-7 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-ui-sm text-content/60 hover:bg-surface-hover hover:text-content ${workflowsActive ? "bg-selection text-content" : ""}`}
        >
          <Workflow className="size-3.5 shrink-0" />
          <span className="truncate">{t("Saved workflows")}</span>
        </button>
      </div>
    </TooltipProvider>
  );
}
