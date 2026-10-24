import type { ReactNode } from "react";
import { WorkflowPresentationContext, type WorkflowPresentation } from "../../features/workflows/ui/workflowPresentation";
import { ModelPicker, ModelControlPills } from "../../features/sessions/ui/ModelPicker";
import { AgentTranscript } from "../../features/sessions/ui/AgentTranscript";

const presentation: WorkflowPresentation = {
  renderRuntimePicker: ({ runtime, cwd, onChange }) => <>
    <ModelPicker harness={runtime.harness} model={runtime.model} values={runtime.modelSettings} project={cwd} hideSettings
      onChange={(harness, model) => onChange({ harness, model, modelSettings: harness === runtime.harness ? runtime.modelSettings : {} })}
      onSettingsChange={(modelSettings) => onChange({ ...runtime, modelSettings })} />
    <ModelControlPills harness={runtime.harness} model={runtime.model} values={runtime.modelSettings}
      onSettingsChange={(modelSettings) => onChange({ ...runtime, modelSettings })} />
  </>,
  renderTranscript: ({ session, visible, onApproval, onOpenFile }) => <AgentTranscript
    blocks={session.blocks} busy={!!session.busy} visible={visible} cwd={session.cwd}
    harness={session.harness} model={session.model} modelSettings={session.modelSettings}
    executionState={session.executionState} managed onApproval={onApproval}
    {...(onOpenFile ? { onOpenFile } : {})} />,
};

export function WorkflowPresentationProvider({ children }: { children: ReactNode }) {
  return <WorkflowPresentationContext.Provider value={presentation}>{children}</WorkflowPresentationContext.Provider>;
}
