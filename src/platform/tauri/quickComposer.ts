import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { AgentModel, Attachment, HarnessId, RuntimeMode, WorkspaceMode } from "../../contracts/session";

/** Cross-window payloads are delivered to the workspace, which submits to Host. */
export interface QuickComposerRequest {
  prompt: string;
  draft?: boolean;
  intent?: "plan" | "orchestrate";
  cwd: string;
  harness: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  runtimeMode?: RuntimeMode;
  attachments?: Attachment[];
  workspaceMode?: WorkspaceMode;
  worktreeBase?: string;
  executionCwd?: string;
  reveal: boolean;
}

export type QuickComposerSignal = "quick_composer_launch" | "quick_composer_shown"
  | "quick_composer_catalog_request" | "quick_composer_catalog";

export function configureQuickComposerShortcut(enabled: boolean, shortcut: string): Promise<void> {
  return invoke("quick_composer_set_enabled", { enabled, shortcut });
}

export function prepareQuickComposerWindow(): Promise<boolean> {
  return invoke("quick_composer_prepare");
}

export function fitQuickComposerWindow(height: number): Promise<void> {
  return invoke("quick_composer_fit", { height });
}

export function dismissQuickComposerWindow(): Promise<void> {
  return invoke("quick_composer_dismiss");
}

export function submitQuickComposerLaunch(request: QuickComposerRequest): Promise<void> {
  return invoke("quick_composer_submit", { request });
}

export function takeQuickComposerLaunch(): Promise<unknown> {
  return invoke("quick_composer_take");
}

export function acknowledgeQuickComposerLaunch(id: string): Promise<void> {
  return invoke("quick_composer_ack", { id });
}

export function subscribeQuickComposerSignal(signal: QuickComposerSignal, handler: (event: { payload: unknown }) => void): Promise<() => void> {
  return listen(signal, handler);
}

export function requestQuickComposerCatalog(harness: HarnessId): Promise<void> {
  return emit("quick_composer_catalog_request", harness);
}

export function publishQuickComposerCatalog(catalog: {
  models: Partial<Record<HarnessId, AgentModel[]>>;
  availableHarnesses: HarnessId[];
}): Promise<void> {
  return emit("quick_composer_catalog", catalog);
}

export function captureQuickComposerScreen(): Promise<string | null> {
  return invoke("quick_composer_capture");
}

export function releaseQuickComposerCaptures(paths: string[]): Promise<void> {
  return invoke("quick_composer_release_capture", { paths });
}
