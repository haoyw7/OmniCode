// The Workflows app view: the saved-workflows hub (global and per-project
// groups, run with arguments, detail, run history, create via chat).
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Workflow } from "../../../shared/ui/icons";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import { SavedWorkflowsSection } from "../kit/settings/saved-workflows/SavedWorkflowsSection";
import { useWorkflowApp } from "./workflowAppContext";
import { AppPageHeader } from "../../workspace/ui/AppPageHeader";

export function WorkflowsView({ cwd }: { cwd: string }) {
  const { t } = useTranslation();
  const app = useWorkflowApp();
  return (
    <div
      role="region"
      aria-label={t("Workflows")}
      data-app-workflows
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <AppPageHeader title={t("Workflows")} icon={Workflow} />
      <TooltipProvider delayDuration={300}>
        <div className="content-surface min-h-0 flex-1 overflow-y-auto font-sans">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <SavedWorkflowsSection
              workspacePath={cwd}
              {...(app
                ? {
                    onNavigateToLaunchedRun: (target, sessionId) => app.openSession(target.workspacePath, sessionId),
                    onCreateViaChat: (prompt, target) => app.createViaChat(target.workspacePath, prompt),
                    onOpenWorkflowRun: (params) => app.openSession(params.workspacePath, params.sessionId),
                  }
                : {})}
            />
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
