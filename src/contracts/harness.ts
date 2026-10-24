import type { AgentStepKind, AgentRunMeta, Attachment, InterjectionMeta, TaskListItem, ToolPreview, TurnMetrics, UserQuestion, UserQuestionReply, SessionModelSettings } from "./session";

export type HarnessEvent =
  | { type: "session.titleUpdated"; providerSessionId: string; title: string }
  | { type: "session.titleRefreshRequested"; providerSessionId: string }
  | { type: "session.started" }
  | { type: "session.ended"; code?: number | null }
  | { type: "session.error"; message: string }
  | {
      type: "session.providerBound";
      providerSessionId: string;
      providerAccountId?: string;
    }
  | { type: "turn.started"; providerTurnId: string }
  | {
      type: "session.configChanged";
      model?: string;
      modelSettings?: Record<string, string>;
      modelSettingOptions?: SessionModelSettings;
    }
  | {
      type: "status";
      text: string;
      key?: string;
      /** A non-terminal warning that must remain visible outside folded work. */
      notice?: "warning";
    }
  /** The provider refused the turn until its usage window resets (epoch ms). */
  | { type: "usage.limited"; resetsAt?: number }
  /**
   * The agent has yielded but the turn is not over: work it started is still
   * running and will wake it again. Empty once it is back at work.
   */
  | { type: "background.updated"; tasks: string[] }
  | ({ type: "interjection"; text: string } & InterjectionMeta)
  | { type: "message.delta"; text: string }
  | { type: "message.completed" }
  | {
      type: "image.generated";
      agentCallId?: string;
      itemId: string;
      data: string;
      name: string;
      mimeType?: string;
      alt?: string;
    }
  | {
      type: "image.generated";
      agentCallId?: string;
      itemId: string;
      path: string;
      name: string;
      mimeType: string;
      size: number;
      alt?: string;
      /** Session-owned attachment reference for scoped remote image reads. */
      attachment?: Attachment;
    }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.completed" }
  | {
      type: "tool.started";
      agentModel?: string;
      callId: string;
      title: string;
      kind?: string;
      status?: string;
      /** Work the agent left running when it yielded. */
      background?: boolean;
      /** Provider identity used to stop this task without interrupting its turn. */
      backgroundTaskId?: string;
      /** Provider-reported epoch time and duration, when available. */
      startedAt?: number;
      durationMs?: number;
      preview?: ToolPreview;
      /** Every path affected when one structured edit changes multiple files. */
      paths?: string[];
    }
  | {
      type: "tool.updated";
      agentModel?: string;
      callId: string;
      title?: string;
      kind?: string;
      status?: string;
      detail?: string;
      /** Observer output, independent of the short transcript row detail. */
      output?: string;
      durationMs?: number;
      preview?: ToolPreview;
      /** Every path affected when one structured edit changes multiple files. */
      paths?: string[];
    }
  /** Something a subagent did, mirrored onto its parent Agent tool call. */
  | {
      type: "agent.step";
      /** Tool call id of the parent Agent/Task call. */
      callId: string;
      /** Provider step identity; repeats merge onto the same row. */
      stepId: string;
      kind: AgentStepKind;
      text: string;
      /** Tool kind for a "tool" step, so it gets the right icon. */
      toolKind?: string;
      status?: string;
      detail?: string;
      preview?: ToolPreview;
      /** The subagent's own name, when the provider only reveals it here. */
      agentName?: string;
      agentType?: string;
      /** Actual child tool identity when stepId is namespaced. */
      toolCallId?: string;
      input?: string;
      output?: string;
      append?: boolean;
      streaming?: boolean;
      /** Explicit nested path, excluding callId, when IDs are not globally unique. */
      agentPath?: string[];
    }
  | {
      type: "agent.updated";
      callId: string;
      agentPath?: string[];
      name?: string;
      model?: string;
      agentType?: string;
      providerSessionId?: string;
      prompt?: string;
      coverage?: AgentRunMeta["coverage"];
    }
  | {
      type: "approval.requested";
      requestId: number;
      title: string;
      kind?: string;
      callId?: string;
      preview?: ToolPreview;
    }
  | {
      type: "approval.resolved";
      requestId: number;
      /** "cancelled" = a PermissionRequest hook decided before the user could. */
      decision: "allow" | "deny" | "cancelled";
    }
  | {
      type: "question.asked";
      requestId: number;
      title?: string;
      questions: UserQuestion[];
      callId?: string;
      autoResolveAt?: number;
      allowLateReply?: boolean;
      providerQuestionId?: string;
    }
  | {
      type: "question.updated";
      requestId: number;
      autoResolveAt?: number;
    }
  | {
      type: "question.resolved";
      requestId: number;
      decision: "answered" | "skipped" | "cancelled";
      reply?: Extract<UserQuestionReply, { kind: "answered" }>;
    }
  | {
      type: "tasks.updated";
      key?: string;
      explanation?: string;
      /** Merge changed items into the existing list instead of replacing it. */
      merge?: boolean;
      /** This snapshot owns its labels, so a changed item text is a rename. */
      authoritative?: boolean;
      /** Provider conversation that owns these items. */
      providerSessionId?: string;
      items: TaskListItem[];
    }
  | {
      type: "plan";
      text: string;
      /** Merge identity for deltas and the authoritative completed item. */
      key?: string;
      /** Append a stream delta instead of replacing the current snapshot. */
      append?: boolean;
      /** False marks the plan ready for review. */
      streaming?: boolean;
    }
  /** Context-window level after the harness's latest request. */
  | {
      type: "context";
      used?: number;
      window?: number;
      breakdown?: import("./session").ContextBreakdown | null;
    }
  /** Provider token accounting for the active user turn. */
  | ({ type: "turn.metrics" } & TurnMetrics);

export type ApprovalDecision = "allow" | "deny";
