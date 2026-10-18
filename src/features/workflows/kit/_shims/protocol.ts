// Monocode stand-in for `@zcode/shared/zcode-protocol-v4`: re-exports the ported
// workflow protocol and defines the few command/row types the workflow UI reads.
import { z } from "zod";

export * from "../../../../integrations/workflow/protocol/workflow-runs";
export * from "../../../../integrations/workflow/protocol/workflow-runs-caps";
export * from "../../../../integrations/workflow/protocol/workflow-artifacts";
export * from "../../../../integrations/workflow/protocol/workflow-artifact";
export * from "../../../../integrations/workflow/protocol/workflow-row-meta";
export * from "../../../../integrations/workflow/protocol/sessions-index-workflow-activity";
export * from "../../../../integrations/workflow/protocol/create-workflow-display";
export * from "../../../../integrations/workflow/protocol/workflow-observation-display";

export const PROTOCOL_V4_LIMITS = {
  attachmentMaxBytes: 20 * 1024 * 1024,
  attachmentChunkMaxBytes: 512 * 1024,
} as const;

/** Result of a Host workflow command, shaped like ZCode's command ack. */
export type CommandAck = {
  commandId: string;
  status: "accepted" | "rejected" | "stale" | "duplicate" | "noop" | "failed";
  reasonCode?: string;
  message?: string;
  revisionAtDecision: number;
  result?: unknown;
};

export const savedWorkflowStartRejectionReasonSchema = z.enum([
  "invalid_name",
  "not_found",
  "invalid_args",
  "compile_failed",
  "session_busy",
  "start_failed",
]);
export type SavedWorkflowStartRejectionReason = z.infer<typeof savedWorkflowStartRejectionReasonSchema>;

export const WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX = "fault.command.workflowRunResumeRejected." as const;
export const BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX = "fault.command.backgroundWorkCancelRejected." as const;

/**
 * The ZCode conversation rows the workflow views read: the launching tool call
 * (with the analysis graph) and, for user-launched runs, the launch turn.
 * Monocode builds them from the conversation's workflow run-card blocks.
 */
export type ConversationRow =
  | {
      kind: "toolCall";
      rowId: string;
      toolCallId: string;
      display?: { kind: "create_workflow"; causalityGraph?: import("../../../../integrations/workflow/protocol/create-workflow-display").ToolCallCreateWorkflowCausalityGraph };
    }
  | {
      kind: "turnHeader" | "userInput";
      rowId: string;
      startedAt?: number;
      createdAt?: number;
      workflowLaunch?: import("../../../../integrations/workflow/protocol/workflow-row-meta").WorkflowLaunchMeta;
    };

/** The slice of ZCode session config the run settings read: the session model. */
export type SessionConfigState = {
  model?: { providerId?: string; modelId?: string; reasoningLevel?: string };
  [key: string]: unknown;
};
