// Monocode shim for ZCode's V4 conversation context: Host session leases, the
// three run commands the workflow views send, and the artifact queries — all
// served by the Host workflow service through `workflows.request`.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { workflowRequest } from "../../model/workflowClient";
import { watchHostSession } from "../../model/workflowSessionWatch";
import type { CommandAck, WorkflowRunArtifact } from "../_shims/protocol.js";
import { BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX, WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX } from "../_shims/protocol.js";
import type { CommandEnvelope } from "./commandFactory.js";
import type { PaneWorkspaceScope } from "./paneLayoutStore.js";
import type { SessionLease } from "./sessionDataLayer.js";

export type WorkflowArtifactItem = { sequence: number; siteId: string; ordinal: number; item: unknown };

export interface V4ConversationValue {
  scope: PaneWorkspaceScope;
  layer: { acquire(sessionId: string): SessionLease };
  sendCommand(envelope: CommandEnvelope): Promise<CommandAck>;
  workflowRunArtifacts(params: { sessionId: string; runId: string }): Promise<{ artifacts: WorkflowRunArtifact[] }>;
  workflowRunArtifactData(params: { sessionId: string; runId: string; artifactId: string; afterSequence?: number; limit: number }): Promise<{ items: WorkflowArtifactItem[]; hasMore: boolean }>;
  workflowRunArtifactRead(params: { sessionId: string; runId: string; artifactId: string; version?: number; offset: number; limit: number }): Promise<{ mediaType: string; totalBytes: number; dataBase64: string; nextOffset: number | null }>;
}

const V4ConversationContext = createContext<V4ConversationValue | null>(null);

function ack(envelope: CommandEnvelope, status: CommandAck["status"], extra: Partial<CommandAck> = {}): CommandAck {
  return { commandId: envelope.commandId, status, revisionAtDecision: 0, ...extra };
}

export function createWorkflowConversation(scope: PaneWorkspaceScope): V4ConversationValue {
  const cwd = scope.workspacePath;
  const leases = new Map<string, SessionLease>();
  const refresh = (sessionId: string | null) => { if (sessionId) leases.get(sessionId)?.refresh(); };
  return {
    scope,
    layer: {
      acquire: (sessionId) => {
        const lease = watchHostSession(cwd, sessionId);
        leases.set(sessionId, lease);
        return lease;
      },
    },
    async sendCommand(envelope) {
      const runId = String(envelope.payload.workId ?? "");
      try {
        switch (envelope.type) {
          case "cancelBackgroundWork": {
            const result = await workflowRequest<{ status: string }>(cwd, "cancel", { runId });
            refresh(envelope.sessionId);
            return result.status === "running"
              ? ack(envelope, "rejected", { reasonCode: `${BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX}not_running` })
              : ack(envelope, "accepted");
          }
          case "resumeWorkflowRun": {
            const result = await workflowRequest<{ ok: boolean; reason?: string; message?: string }>(cwd, "resume", { runId });
            refresh(envelope.sessionId);
            return result.ok
              ? ack(envelope, "accepted")
              : ack(envelope, "rejected", { reasonCode: `${WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX}${result.reason ?? "not_resumable"}`, ...(result.message ? { message: result.message } : {}) });
          }
          case "amendWorkflowRunSettings": {
            const change: Record<string, unknown> = {};
            if ("maxConcurrency" in envelope.payload) change.maxConcurrency = envelope.payload.maxConcurrency;
            if ("defaults" in envelope.payload) change.defaults = envelope.payload.defaults;
            if ("agents" in envelope.payload) change.agents = envelope.payload.agents;
            await workflowRequest(cwd, "retune", { runId, ...change });
            refresh(envelope.sessionId);
            return ack(envelope, "accepted", { result: { type: "amendWorkflowRunSettings", runId } });
          }
          default:
            return ack(envelope, "rejected", { reasonCode: "fault.command.capabilityUnsupported", message: `Unsupported workflow command ${envelope.type}` });
        }
      } catch (error) {
        return ack(envelope, "failed", { message: error instanceof Error ? error.message : String(error) });
      }
    },
    workflowRunArtifacts: ({ runId }) => workflowRequest(cwd, "artifacts", { runId }),
    workflowRunArtifactData: ({ runId, artifactId, afterSequence, limit }) =>
      workflowRequest(cwd, "artifactData", { runId, artifactId, limit, ...(afterSequence === undefined ? {} : { afterSequence }) }),
    workflowRunArtifactRead: ({ runId, artifactId, version, offset, limit }) =>
      workflowRequest(cwd, "artifactRead", { runId, artifactId, offset, limit, ...(version === undefined ? {} : { version }) }),
  };
}

export function V4PaneConversationProvider({ scope, children }: { scope: PaneWorkspaceScope; children: ReactNode }) {
  const value = useMemo(() => createWorkflowConversation(scope), [scope.workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps
  return <V4ConversationContext.Provider value={value}>{children}</V4ConversationContext.Provider>;
}

export function useV4Conversation(): V4ConversationValue {
  const value = useContext(V4ConversationContext);
  if (!value) throw new Error("Workflow views must render inside V4PaneConversationProvider");
  return value;
}
