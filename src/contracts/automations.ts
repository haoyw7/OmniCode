import type { HarnessId, RuntimeMode } from "./session";

export type AutomationWorkspaceMode = "current" | "worktree" | "existing";

export type AutomationScheduleKind = "hourly" | "daily" | "weekdays" | "weekly";

export type AutomationTriggerKind =
  "time" | "github" | "linear" | "jira" | "gitlab" | "azuredevops";

export type AutomationTrigger = {
  id: string;
  kind: AutomationTriggerKind;
  event: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  repos: string[];
  repo: string;
  branch: string;
  actor: string;
};

export type AutomationRunStatus =
  "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  cwd: string;
  workspaceMode: AutomationWorkspaceMode;
  executionCwd?: string;
  sessionFolderId?: string;
  reuseSession: boolean;
  runtimeMode: RuntimeMode;
  triggerKind: AutomationTriggerKind;
  triggerEvent: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  triggers?: AutomationTrigger[] | null;
  missedRunGraceMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: AutomationRunStatus;
  lastRunError?: string;
  lastSessionId?: string;
  createdAt: number;
  updatedAt: number;
};

export type AutomationUpsert = Omit<
  Automation,
  | "lastRunAt"
  | "lastRunStatus"
  | "lastRunError"
  | "lastSessionId"
  | "createdAt"
  | "updatedAt"
>;

export type AutomationRunTrigger = "scheduled" | "manual" | "event";

export type AutomationRun = {
  id: string;
  automationId: string;
  trigger: AutomationRunTrigger;
  scheduledFor: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: AutomationRunStatus;
  sessionId?: string;
  error?: string;
  eventKey?: string;
  eventKind?: AutomationTriggerKind;
  event?: string;
  prompt?: string;
};

export type DueAutomationRun = {
  automation: Automation;
  run: AutomationRun;
};

export type AutomationDraft = {
  id?: string;
  name: string;
  prompt: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  cwd: string;
  workspaceMode: AutomationWorkspaceMode;
  executionCwd: string;
  sessionFolderId: string;
  reuseSession: boolean;
  runtimeMode: RuntimeMode;
  triggerKind: AutomationTriggerKind;
  triggerEvent: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  triggers: AutomationTrigger[];
  missedRunGraceMinutes: number;
  enabled: boolean;
};
