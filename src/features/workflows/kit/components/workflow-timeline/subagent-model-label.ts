// Subagent runtime labels. Adapted from ZCode (Apache-2.0): ZCode labels one
// canonical `providerId/modelId[$level]` string per run; Monocode runs carry a
// runtime label per subagent ("codex · gpt-5.5 · high · fast") and, for runs
// with run-level defaults, the same kind of label on `run.subagentModel`.

type FormatMessage = (descriptor: { id: string }, values?: Record<string, string | number>) => string;

export interface WorkflowSubagentModelLabel {
  name: string;
  level?: string;
  canonical: string;
}

export interface WorkflowSubagentModelDeps {
  formatMessage: FormatMessage;
  providerName?: (providerId: string) => string | undefined;
}

export function describeWorkflowSubagentModel(canonical: string, _deps: WorkflowSubagentModelDeps): WorkflowSubagentModelLabel {
  const trimmed = canonical.trim();
  return { canonical: trimmed, name: trimmed };
}

export function workflowSubagentModelText(formatMessage: FormatMessage, label: WorkflowSubagentModelLabel): string {
  return label.level === undefined
    ? label.name
    : formatMessage({ id: "chat.toolCall.workflow.subagentModel.withLevel" }, { level: label.level, model: label.name });
}

export function workflowSubagentModelTooltip(formatMessage: FormatMessage, label: WorkflowSubagentModelLabel): string {
  return formatMessage({ id: "chat.toolCall.workflow.subagentModel.tooltip" }, { model: workflowSubagentModelText(formatMessage, label) });
}

export function workflowSubagentModelCardLabel(canonical: string | undefined, deps: WorkflowSubagentModelDeps): { name: string; title: string } | undefined {
  if (canonical === undefined) return undefined;
  const label = describeWorkflowSubagentModel(canonical, deps);
  return { name: label.name, title: workflowSubagentModelTooltip(deps.formatMessage, label) };
}
