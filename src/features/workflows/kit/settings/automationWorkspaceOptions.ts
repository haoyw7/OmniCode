// Project options for the saved-workflows hub. Adapted from ZCode (Apache-2.0)
// packages/ui/src/settings/automationWorkspaceOptions.ts over Monocode projects.
import { resolveWorkspaceKey } from "../_shims/shared.js";

/** An open Monocode project. */
export interface WindowTabState {
  workspacePath: string;
  label: string;
}

export interface AutomationWorkspaceOption {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  label: string;
}

export function resolveAutomationWorkspaceSelectionKey(workspace: Pick<AutomationWorkspaceOption, "workspacePath" | "workspaceIdentity">): string {
  return resolveWorkspaceKey(workspace);
}

export function findAutomationWorkspaceOptionByKey(options: readonly AutomationWorkspaceOption[], workspaceKey: string | null): AutomationWorkspaceOption | undefined {
  return options.find((option) => resolveAutomationWorkspaceSelectionKey(option) === workspaceKey);
}

export function reconcileAutomationWorkspaceSelectionKey(
  options: readonly AutomationWorkspaceOption[],
  currentWorkspaceKey: string | null,
  preferredWorkspace?: Pick<AutomationWorkspaceOption, "workspacePath" | "workspaceIdentity">,
): string | null {
  const current = findAutomationWorkspaceOptionByKey(options, currentWorkspaceKey);
  if (current) return resolveAutomationWorkspaceSelectionKey(current);
  const preferred = preferredWorkspace ? findAutomationWorkspaceOptionByKey(options, resolveAutomationWorkspaceSelectionKey(preferredWorkspace)) : undefined;
  if (preferred) return resolveAutomationWorkspaceSelectionKey(preferred);
  const first = options[0];
  return first ? resolveAutomationWorkspaceSelectionKey(first) : null;
}

export function buildAutomationWorkspaceOptions(tabs: readonly WindowTabState[]): AutomationWorkspaceOption[] {
  const byKey = new Map<string, AutomationWorkspaceOption>();
  for (const tab of tabs) {
    const key = resolveWorkspaceKey({ workspacePath: tab.workspacePath });
    if (!byKey.has(key)) byKey.set(key, { workspacePath: tab.workspacePath, label: tab.label });
  }
  return [...byKey.values()];
}
