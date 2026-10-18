import type { RuntimeMode, TurnOrigin } from "../../sessions/model/session";
import type {
  RemoteProvider,
  RemoteAttachment,
} from "../../connections/model/protocol";
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";
import type { BotHabit } from "./botHabits";

export const BOT_PERMISSIONS = [
  "catalog.read",
  "projects.read",
  "projects.open",
  "sessions.read",
  "sessions.create",
  "sessions.send",
  "sessions.configure",
  "sessions.cancel",
  "sessions.approve",
  "sessions.answer",
  "sessions.queue",
  "sessions.metadata",
  "sessions.delete",
  "orchestration.control",
  "files.read",
  "files.write",
  "git.read",
  "git.write",
  "git.publish",
] as const;
export type BotPermission = (typeof BOT_PERMISSIONS)[number];
export type BotPolicy = {
  permissions: Record<BotPermission, boolean>;
  allowedProjects: "all" | string[];
  /** Explicitly followed conversations; operations still require configured permissions. */
  followedSessions?: { projectId: string; sessionId: string }[];
  /** Ongoing follow rules, including conversations created later. */
  followedProjects?: "all" | string[];
  /** Individual removals override ongoing rules. */
  excludedSessionIds?: string[];
};
export const fullBotPolicy = (): BotPolicy => ({
  permissions: Object.fromEntries(
    BOT_PERMISSIONS.map((key) => [key, true]),
  ) as BotPolicy["permissions"],
  allowedProjects: "all",
});
export type BotLifecycle =
  | "idle"
  | "running"
  | "paused"
  | "backoff"
  | "interrupted"
  | "failed"
  | "disabled";
export type BotEventKind =
  "completed" | "failed" | "approval" | "question" | "interrupted";
export type SessionReference = {
  environmentId: string;
  projectId: string;
  sessionId: string;
};
export type BotSchedule = {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  prompt: string;
  timezone: string;
  nextRunAt: number;
};
export type BotWatch = {
  id: string;
  enabled: boolean;
  projectIds: string[];
  sessionIds: string[];
  eventKinds: BotEventKind[];
  prompt: string;
};
export const BOT_PERSONA_PRESETS = [
  "secretary",
  "partner",
  "engineer",
  "custom",
] as const;
export type BotPersonaPreset = (typeof BOT_PERSONA_PRESETS)[number];
export type BotPersona = {
  preset: BotPersonaPreset;
  /** Extra free-form personality and tone guidance written by the user. */
  style: string;
  /** How the assistant addresses the user. */
  userName?: string;
};
export const defaultBotPersona = (): BotPersona => ({
  preset: "secretary",
  style: "",
});
/** A one-shot follow-up the assistant promised during a conversation. */
export type BotReminder = {
  id: string;
  dueAt: number;
  prompt: string;
  createdAt: number;
  createdBy: string;
  rootCauseId: string;
  state: "pending" | "fired" | "cancelled";
};
/** The platform action the assistant is performing in the current turn. */
export type BotActivity = {
  action: string;
  projectName?: string;
  sessionTitle?: string;
  at: number;
};
export type BotToolConfiguration = {
  /** Omitted means all Host assistant actions allowed by the current policy. */
  enabledActions?: string[];
  /** A run which uses the Host computer must hold its exclusive resource lease. */
  computer?: boolean;
};
export type BotConfiguration = {
  id: string;
  name: string;
  /** Optional short avatar text, limited to eight Unicode code points. */
  avatar?: string;
  persona?: BotPersona;
  /** IANA time zone used for the assistant's sense of local time. */
  timezone?: string;
  reminders?: BotReminder[];
  /** Calendar tasks; absent on Hosts without habits. */
  habits?: BotHabit[];
  activity?: BotActivity;
  revision: number;
  chatRevision: number;
  enabled: boolean;
  /** Host-wide Bot scheduling gate, independent of the selected Thread state. */
  paused?: boolean;
  lifecycle: BotLifecycle;
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  /** Defaults to three concurrent Threads; each Thread still runs one turn at a time. */
  maxConcurrentRuns?: number;
  /** Optional absolute execution directory, separate from the Bot memory workspace. */
  workingDirectory?: string;
  tools?: BotToolConfiguration;
  /** Same-Host Bots this Bot may call; omitted means no delegation targets. */
  callableBotIds?: string[];
  runtimeMode: RuntimeMode;
  targetRuntimeMode: RuntimeMode;
  policy: BotPolicy;
  policyVersion: number;
  triggers: { user: boolean; event: boolean; schedule: boolean };
  schedules: BotSchedule[];
  watches: BotWatch[];
  maxAutoTurns: number;
  chainWindowMinutes: number;
  brainGeneration: number;
  nextRetryAt?: number;
  error?: string;
  backlog?: boolean;
  /** Resident memory version; absent on Hosts without assistant memory. */
  memory?: { revision: number; lines: number };
  /** Playbook version and count; absent on Hosts without playbooks. */
  playbooks?: { revision: number; count: number };
};
/** A procedure the assistant keeps, in SKILL.md form. */
export type BotPlaybook = {
  name: string;
  /** When to use it. */
  description: string;
  updated: string;
  /** Date of the last run that followed it successfully. */
  verified?: string;
  body: string;
};
/** Resident memory as `assistant.memory` returns it. */
export type BotMemory = {
  revision: number;
  facts: BotMemoryFact[];
  /** Topic notes the assistant keeps; bodies are read on demand. */
  topics: string[];
};
export type BotMemoryTopic = {
  name: string;
  text: string;
  revision: number;
};
export type BotMemoryFact = {
  /** Line index in the memory document, for editing or forgetting it. */
  index: number;
  text: string;
  date?: string;
  until?: string;
  /** Superseded by a newer entry; kept for the record. */
  struck: boolean;
};
export type BotPatch = Partial<
  Pick<
    BotConfiguration,
    | "name"
    | "avatar"
    | "persona"
    | "timezone"
    | "harness"
    | "model"
    | "modelSettings"
    | "maxConcurrentRuns"
    | "tools"
    | "callableBotIds"
    | "runtimeMode"
    | "targetRuntimeMode"
    | "policy"
    | "triggers"
    | "schedules"
    | "watches"
    | "maxAutoTurns"
    | "chainWindowMinutes"
  >
> & { workingDirectory?: string | null };
type MessageBase = {
  id: string;
  revision: number;
  createdAt: number;
  /** The Host wakeup that produced this public message, when known. */
  wakeupId?: string;
};
export type BotMessage = MessageBase &
  (
    | {
        kind: "user" | "assistant";
        text: string;
        streaming?: boolean;
        /** Host began processing this user input; null means still pending. */
        readAt?: number | null;
        attachments?: RemoteAttachment[];
      }
    | {
        kind: "session-card";
        ref: SessionReference;
        title: string;
        projectName: string;
        harness: RemoteProvider;
        model: string;
        actionId: string;
        status:
          | "accepted"
          | "queued"
          | "running"
          | "completed"
          | "failed"
          | "unknown"
          | "unavailable";
        error?: string;
      }
    | { kind: "status"; text: string; code?: string; delegationId?: string }
    | {
        kind: "input";
        text: string;
        brainGeneration: number;
        runId: string;
        requestId: number;
        inputKind: "approval" | "question";
        question?: UserQuestionPrompt;
        resolved: boolean;
      }
  );
export type BotMessages = {
  revision: number;
  entries: BotMessage[];
  hasMore: boolean;
  nextRevision: number;
};
/** Creation order stays stable when a reply streams or a card changes status. */
export type BotHistoryCursor = { createdAt: number; id: string };
/** Newest public message snapshots, with the view from the same Host read. */
export type BotHistory = {
  assistant: BotConfiguration | null;
  entries: BotMessage[];
  hasMore: boolean;
  nextCursor?: BotHistoryCursor;
};
export type BotReceipt = {
  commandId: string;
  revision: number;
  messageId?: string;
  wakeupId?: string;
};
export type BotAction = {
  id: string;
  requestId: string;
  signature: string;
  action: string;
  input: Record<string, unknown>;
  origin: TurnOrigin;
  rootCauseId: string;
  state: "executing" | "accepted" | "completed" | "failed" | "unknown";
  result?: unknown;
  error?: string;
  targetRef?: SessionReference;
};
