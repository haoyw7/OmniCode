// Run lines under a conversation row in the left sidebar: a rail of
// phase lights and the current phase; clicking one opens the run's detail tab.
import { TaskWorkflowRunLines } from "../kit/components/workflow-run-line/TaskWorkflowRunLines";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import { useWorkflowIntl } from "../kit/i18n/IntlProvider";
import { useWorkflowActivity } from "../model/workflowActivity";

export function SessionWorkflowRunLines({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
  const entry = useWorkflowActivity(sessionId);
  const { intl } = useWorkflowIntl();
  if (!entry) return null;
  return (
    <TooltipProvider delayDuration={400}>
      <TaskWorkflowRunLines
      activity={entry.activity}
      isActive={isActive}
      intl={intl}
      session={{ workspacePath: entry.cwd, sessionId: entry.sessionId }}
      className="mt-1"
      />
    </TooltipProvider>
  );
}
