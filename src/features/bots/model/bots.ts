import type { RemoteProvider } from "../../connections/model/protocol";
import type { BotLifecycle, BotConfiguration, BotToolConfiguration } from "./botView";
import type { RuntimeMode } from "../../sessions/model/session";

/** Host identity is supplied by the connection, never by a client-owned field. */
export type BotScope = { botId: string; threadId: string };
export type BotThreadKind = "direct" | "automatic" | "delegation" | "room";
export type BotModelOverride = {
  harness: RemoteProvider;
  model: string;
  modelSettings?: Record<string, string>;
};
export type BotView = BotConfiguration & {
  defaultThreadId: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
};
export type BotThread = {
  id: string;
  botId: string;
  kind: BotThreadKind;
  title: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
  modelOverride?: BotModelOverride;
  lifecycle: BotLifecycle;
  chatRevision: number;
};
export type BotsSnapshot = {
  revision: number;
  bots: BotView[];
  threads: BotThread[];
  defaultBotId?: string;
  defaultThreadId?: string;
};

export type BotRunStatus = "queued" | "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted";
export type BotRun = BotScope & {
  id: string;
  wakeupId: string;
  attempt: number;
  status: BotRunStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  /** Host-managed brain record and turn, distinct from a CLI's native session ID. */
  brainSessionId?: string;
  hostRunId?: string;
  providerSessionId?: string;
  mergedInto?: string;
  error?: string;
  config?: {
    revision: number; harness: RemoteProvider; model: string; modelSettings: Record<string, string>;
    runtimeMode: RuntimeMode; policyVersion: number; workingDirectory?: string; tools?: BotToolConfiguration; contextHash?: string;
  };
  capabilities?: { systemInstructions: "native" | "context-block"; mcp: "native" | "unavailable"; toolBridge: "control-cli" | "unavailable"; limitations: string[] };
};
export type BotRunCursor = { createdAt: number; id: string };
export type BotRuns = { revision: number; runs: BotRun[]; hasMore: boolean; next?: BotRunCursor };

export function botCacheKey(environmentId: string, scope: BotScope): string {
  return JSON.stringify([environmentId, scope.botId, scope.threadId]);
}

/** A single-hop task owned by its originating Host run. */
export type BotDelegationStatus = "running" | "completed" | "busy" | "failed" | "cancelled" | "timed_out" | "interrupted";
export type BotDelegation = {
  id: string;
  source: BotScope & { runId: string };
  target: { botId: string; threadId?: string; runId?: string };
  requestId: string;
  prompt: string;
  /** Chief background tasks survive only a normally completed parent turn. */
  mode?: "attached" | "background";
  teamId?: string;
  status: BotDelegationStatus;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
  completedAt?: number;
  result?: string;
  resultTruncated?: boolean;
  error?: string;
};
export type BotDelegations = {
  revision: number;
  delegations: BotDelegation[];
  hasMore: boolean;
  next?: { createdAt: number; id: string };
};
