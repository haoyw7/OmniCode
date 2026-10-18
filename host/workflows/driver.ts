// Monocode's WorkflowDriver: every workflow actor runs as a hidden Host session
// on the provider, model, thinking level and speed resolved for it. Typed asks
// end their reply with a fenced JSON block that the engine validates; rejected
// results get a repair turn in the same session, missing ones a nudge turn.
// Adapted from ZCode's bootstrap workflow driver (Apache-2.0).

import { createHash } from "node:crypto";
import {
  formatViolation,
  refToString,
  WorkflowError,
  type ActorRef,
  type ArtifactPublishRequest,
  type ArtifactVersionRecord,
  type ActorSessionSeed,
  type AskMessage,
  type InstanceRef,
  type JournalStorePort,
  type PersonaSpec,
  type RunEvent,
  type SessionRef,
  type SubmitVerdict,
  type WorkflowDriver,
  type WorkflowReportSink,
  type WorldReadOp,
} from "../../src/integrations/workflow/dynamic-workflow/index.js";
import type { ControlOutcome } from "../../src/features/orchestration/model/orchestrationRuntime";
import type { WorkflowAgentRuntime } from "../../src/integrations/workflow/createWorkflow.js";
import type { WorkflowResolvedRuntime } from "../../src/integrations/workflow/modelConfig.js";
import { executeArtifactPublish } from "./artifact-publish.js";
import { executeWorldRead } from "./world-read.js";
import { nodeExecutionPort, nodeFileSystemPort, type ToolArtifactStorePort } from "./node-ports.js";

/** Host capabilities the driver needs; HostEngine provides them. */
export interface WorkflowWorkerPort {
  createWorker(input: {
    sessionId: string;
    parentSessionId: string;
    runId: string;
    title: string;
    runtime: WorkflowResolvedRuntime;
  }): void;
  submit(sessionId: string, prompt: string, done: (outcome: ControlOutcome) => void): void;
  stop(sessionId: string): Promise<void>;
}

export interface MonocodeWorkflowDriverOptions {
  runId: string;
  parentSessionId: string;
  cwd: string;
  sink: WorkflowReportSink;
  journal: JournalStorePort;
  workers: WorkflowWorkerPort;
  /** Resolves an actor's runtime from its persona (and the run's layered config). */
  resolveRuntime(persona: PersonaSpec, actorName: string | undefined): WorkflowResolvedRuntime;
  declaredRunCommands: ReadonlySet<string>;
  artifactStore?: ToolArtifactStorePort;
  emit(event: RunEvent): void;
  /** Called after every ask turn with the actor session it ran in. */
  onActivity?(sessionId: string): void;
  /**
   * Recap of a predecessor actor's completed asks, given to a fresh session that
   * continues an amended actor past its cached prefix.
   */
  recap?(seed: ActorSessionSeed): string | undefined;
}

/** Deterministic actor session id, so run events can name it before the session exists. */
export function mintActorSessionId(runId: string, actor: ActorRef): string {
  const hex = createHash("sha256").update(`monocode-workflow\0${runId}\0${refToString(actor)}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type AskState = {
  instance: InstanceRef;
  sessionId: string;
  typed: boolean;
  schema?: unknown;
  turns: number;
  cancelled: boolean;
  settled: boolean;
};

const RESULT_FENCE = "workflow-result";

/** Per-ask quality standard, as in ZCode, without its subagent-only escalate tool. */
export function qualityEpilogue(schema: unknown): string {
  const fields = topLevelSchemaProperties(schema);
  return [
    "",
    "",
    "---",
    "Standard for this result:",
    "- Every finding cites what you read or ran: path and line for code; the exact command and its output for a check; the part of the ask for material the ask itself gave you.",
    "- A check counts as passed only if you ran it during this ask. Otherwise report it as not run.",
    "- Run the check the ask names, at the scale it names. A narrower or faster substitute — one test file for the suite, a build for the tests — is reported as what it is, never as the ask's check; say the exact command you ran.",
    "- Anything you could not do, verify, or find is stated as such — never filled with a plausible guess.",
    ...(fields.has("evidence") ? ["- Put each finding's citation in its `evidence` field."] : []),
    ...(fields.has("confidence") ? ["- Rate `confidence` honestly; a low value with a reason beats a confident guess."] : []),
    "- If you are blocked by something outside your reach, say exactly what blocks you instead of inventing a value.",
  ].join("\n");
}

function topLevelSchemaProperties(schema: unknown): Set<string> {
  if (typeof schema !== "object" || schema === null) return new Set();
  const properties = (schema as { properties?: unknown }).properties;
  return typeof properties === "object" && properties !== null ? new Set(Object.keys(properties)) : new Set();
}

/** Typed-ask epilogue: the result travels as the last fenced JSON block of the reply. */
export function resultEpilogue(schema: unknown): string {
  const rendered = schema === undefined ? "(any JSON value)" : JSON.stringify(schema, null, 2);
  return [
    "",
    "",
    "---",
    `When you have finished, end your final reply with your result as a fenced code block tagged \`${RESULT_FENCE}\` (or \`json\`). Its content must be one JSON value conforming to this JSON Schema:`,
    "",
    rendered,
    "",
    `Example ending:\n\`\`\`${RESULT_FENCE}\n{ ... }\n\`\`\``,
    "Put only the conforming JSON inside that block — no comments, no trailing text inside the fence.",
  ].join("\n");
}

export const NUDGE_PROMPT =
  `You ended your turn without the required result block. Reply now with only a fenced \`${RESULT_FENCE}\` code block containing the JSON result that conforms to the schema you were given.`;

export function repairPrompt(violations: readonly { path: string; expected: string; got: string }[]): string {
  return [
    "Your result block did not conform to the required JSON Schema:",
    ...violations.slice(0, 20).map((violation) => `- ${formatViolation(violation)}`),
    "",
    `Fix the result and reply with a corrected fenced \`${RESULT_FENCE}\` code block containing the whole JSON value.`,
  ].join("\n");
}

/**
 * The last fenced result block of a reply, parsed as JSON. Prefers the tagged
 * block, then the last ```json block, then a reply that is itself bare JSON.
 * Returns `undefined` when no block exists; a block that does not parse is
 * passed through as its raw string so validation reports a useful violation.
 */
export function extractResultBlock(text: string): { found: true; value: unknown } | { found: false } {
  const fences = [...text.matchAll(/```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g)];
  const pick = fences.filter((match) => match[1] === RESULT_FENCE).at(-1)
    ?? fences.filter((match) => match[1]?.toLowerCase() === "json").at(-1);
  const body = pick?.[2]?.trim() ?? (/^[[{]/.test(text.trim()) ? text.trim() : undefined);
  if (body === undefined) return { found: false };
  try { return { found: true, value: JSON.parse(body) }; } catch { return { found: true, value: body }; }
}

export function effectiveActorName(persona: PersonaSpec): string | undefined {
  return persona.name === undefined || persona.name === "" ? undefined : persona.name;
}

export function personaRuntime(persona: PersonaSpec): WorkflowAgentRuntime {
  return {
    ...(persona.provider ? { provider: persona.provider } : {}),
    ...(persona.model ? { model: persona.model } : {}),
    ...(persona.thinking ? { thinking: persona.thinking } : {}),
    ...(persona.speed ? { speed: persona.speed } : {}),
  };
}

export class MonocodeWorkflowDriver implements WorkflowDriver {
  readonly journal: JournalStorePort;
  private readonly asks = new Map<string, AskState>();
  /** Actor sessions whose persona prompt has not been sent yet. */
  private readonly pendingPersona = new Map<string, string>();
  /** Recaps for amended actors, sent with their first live ask. */
  private readonly pendingRecap = new Map<string, string>();
  /** Completed asks per actor session: the journal's message boundary for amend. */
  private readonly askCounts = new Map<string, number>();
  private disposed = false;

  constructor(private readonly options: MonocodeWorkflowDriverOptions) {
    this.journal = options.journal;
  }

  emit(event: RunEvent): void {
    this.options.emit(event);
  }

  async createActorSession(actor: ActorRef, persona: PersonaSpec, seed?: ActorSessionSeed): Promise<SessionRef> {
    const name = effectiveActorName(persona);
    const runtime = this.options.resolveRuntime(persona, name);
    const sessionId = mintActorSessionId(this.options.runId, actor);
    this.options.workers.createWorker({
      sessionId,
      parentSessionId: this.options.parentSessionId,
      runId: this.options.runId,
      title: name ?? `Agent ${refToString(actor)}`,
      runtime,
    });
    // The engine reads this back when it records the actor's session.
    const existing = this.journal.getActor(this.options.runId, actor.siteId, actor.ordinal);
    this.journal.putActor({
      ...(existing ?? { runId: this.options.runId, siteId: actor.siteId, ordinal: actor.ordinal }),
      resolvedModel: JSON.stringify(runtime),
    });
    if (persona.system?.trim()) this.pendingPersona.set(sessionId, persona.system.trim());
    if (seed) {
      const recap = this.options.recap?.(seed);
      if (recap) this.pendingRecap.set(sessionId, recap);
      this.askCounts.set(sessionId, seed.messageCount);
    }
    return { id: sessionId };
  }

  startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
    const key = refToString(instance);
    const state: AskState = { instance, sessionId: session.id, typed: message.typed, schema: message.schema, turns: 0, cancelled: false, settled: false };
    this.asks.set(key, state);
    const persona = this.pendingPersona.get(session.id);
    const recap = this.pendingRecap.get(session.id);
    this.pendingPersona.delete(session.id);
    this.pendingRecap.delete(session.id);
    const prompt = [
      persona ? `Your role for this workflow:\n${persona}\n\n---\n\n` : "",
      recap ? `${recap}\n\n---\n\n` : "",
      message.instructions,
      qualityEpilogue(message.schema),
      message.typed ? resultEpilogue(message.schema) : "",
    ].join("");
    this.options.sink.askExecuting(instance);
    this.turn(state, prompt);
  }

  respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void {
    const state = this.asks.get(refToString(instance));
    if (!state || state.cancelled) return;
    if (verdict.kind === "accept") { this.finish(state); return; }
    const prompt = verdict.kind === "reject" ? repairPrompt(verdict.violations) : NUDGE_PROMPT;
    // The previous turn is still settling in the Host; send the follow-up after it.
    setImmediate(() => { if (!state.cancelled && !state.settled) this.turn(state, prompt); });
  }

  cancelAsk(instance: InstanceRef): void {
    const state = this.asks.get(refToString(instance));
    if (!state || state.settled) return;
    state.cancelled = true;
    this.finish(state);
    void this.options.workers.stop(state.sessionId).catch(() => undefined);
  }

  executeWorldRead(op: WorldReadOp, args: unknown[]): Promise<unknown> {
    return executeWorldRead({
      fileSystemPort: nodeFileSystemPort,
      executionPort: nodeExecutionPort,
      cwd: this.options.cwd,
      declaredRunCommands: this.options.declaredRunCommands,
    }, op, args);
  }

  executeArtifactPublish(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord> {
    return executeArtifactPublish({
      fileSystemPort: nodeFileSystemPort,
      cwd: this.options.cwd,
      ...(this.options.artifactStore ? { artifactStore: this.options.artifactStore } : {}),
      parentSessionId: this.options.parentSessionId,
    }, request);
  }

  dispose(): void {
    this.disposed = true;
    for (const state of this.asks.values()) if (!state.settled) this.cancelAsk(state.instance);
  }

  private finish(state: AskState): void {
    state.settled = true;
    this.asks.delete(refToString(state.instance));
  }

  private turn(state: AskState, prompt: string): void {
    if (this.disposed) return;
    state.turns++;
    this.options.sink.askProgress(state.instance, { turn: state.turns, toolCalls: 0 });
    this.options.workers.submit(state.sessionId, prompt, (outcome) => this.settledTurn(state, outcome));
  }

  private settledTurn(state: AskState, outcome: ControlOutcome): void {
    this.options.onActivity?.(state.sessionId);
    if (state.cancelled || state.settled) return;
    const metrics = outcome.metrics;
    const tokens = (metrics?.inputTokens ?? 0) + (metrics?.outputTokens ?? 0);
    this.options.sink.askProgress(state.instance, { turn: state.turns, toolCalls: outcome.toolCalls ?? 0 });
    this.options.sink.askStats(state.instance, { tokens, toolCalls: outcome.toolCalls ?? 0, turns: state.turns });
    if (outcome.status === "cancelled") {
      this.finish(state);
      this.options.sink.askFailed(state.instance, new WorkflowError("Cancelled", "The subagent turn was stopped."));
      return;
    }
    if (outcome.status === "failed") {
      this.finish(state);
      this.options.sink.askFailed(state.instance, new WorkflowError("DriverError", `Subagent turn failed: ${outcome.error ?? "the provider reported an error"}`));
      return;
    }
    if (!state.typed) {
      this.finish(state);
      this.options.sink.askTurnEnded(state.instance, outcome.text);
      this.recordBoundary(state);
      return;
    }
    const result = extractResultBlock(outcome.text);
    // Both calls may synchronously call respondToSubmit / cancelAsk.
    if (result.found) this.options.sink.askSubmitAttempted(state.instance, result.value);
    else this.options.sink.askTurnEnded(state.instance, outcome.text);
    if (state.settled) this.recordBoundary(state);
  }

  /** Amend imports need each completed ask's position in its actor's conversation. */
  private recordBoundary(state: AskState): void {
    const boundary = (this.askCounts.get(state.sessionId) ?? 0) + 1;
    this.askCounts.set(state.sessionId, boundary);
    const node = this.journal.getNode(this.options.runId, state.instance.siteId, state.instance.ordinal);
    if (node?.status === "completed" && node.messageBoundary === undefined) this.journal.putNode({ ...node, messageBoundary: boundary });
  }
}
