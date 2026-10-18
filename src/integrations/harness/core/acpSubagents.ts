import type { HarnessEvent } from "./types";
import { isFailedStatus } from "../../../features/sessions/model/transcriptActivity";
import {
  agentToolTitle,
  isAgentTool,
  isAgentToolName,
  mergeToolPreview,
} from "./preview";

type Step = Extract<HarnessEvent, { type: "agent.step" }>;

/** Route explicitly attributed ACP child activity without mixing parent text. */
export class AcpSubagents {
  private tools = new Set<string>();
  private owners = new Map<string, string>();
  private pending = new Map<string, HarnessEvent[]>();
  private gaps = new Set<string>();
  private prose = new Map<
    string,
    { id: number; kind: "message" | "reasoning"; text: string }
  >();
  private sequence = 0;

  isChild(params: unknown): boolean {
    return !!this.parent(params);
  }

  route(params: unknown, events: HarnessEvent[]): HarnessEvent[] {
    const parent = this.parent(params);
    if (!parent) {
      return events.flatMap<HarnessEvent>((event) => {
        if (event.type !== "tool.started" && event.type !== "tool.updated")
          return [event];
        this.tools.add(event.callId);
        const backlog = this.pending.get(event.callId) ?? [];
        this.pending.delete(event.callId);
        return this.release([event, ...(event.kind === "agent" ? this.metadata(event.callId, params) : []), ...backlog]);
      });
    }
    const output: HarnessEvent[] = [];
    for (const event of events) {
      if (event.type === "tool.started" || event.type === "tool.updated") {
        this.owners.set(event.callId, parent);
        this.prose.delete(parent);
        output.push({
          type: "agent.step",
          callId: parent,
          stepId: `tool:${event.callId}`,
          toolCallId: event.callId,
          kind: "tool",
          text: event.title ?? "",
          toolKind: event.kind,
          status: event.status,
          // Detail is what a red row opens, so only a call that failed carries
          // one. A settled result is already in the preview, and storing every
          // child's output would weigh the saved session down for nothing.
          ...(event.type === "tool.updated" && isFailedStatus(event.status) &&
          event.detail
            ? { detail: event.detail }
            : {}),
          preview: event.preview,
          ...(event.type === "tool.updated" && event.detail !== undefined ? { output: event.detail } : {}),
          input: this.input(params),
        });
        if (event.kind === "agent" && event.agentModel)
          output.push({ type: "agent.updated", callId: event.callId, model: event.agentModel });
      } else if (
        event.type === "message.delta" ||
        event.type === "reasoning.delta"
      ) {
        const kind = event.type === "message.delta" ? "message" : "reasoning";
        let prose = this.prose.get(parent);
        if (!prose || prose.kind !== kind)
          prose = { id: ++this.sequence, kind, text: "" };
        const update = record(record(params)?.update) ?? record(params);
        const type =
          update?.sessionUpdate ?? update?.session_update ?? update?.type;
        const snapshot = type === "agent_message" || type === "agent_thought";
        prose.text = snapshot ? event.text : prose.text + event.text;
        this.prose.set(parent, prose);
        output.push({
          type: "agent.step",
          callId: parent,
          stepId: `${kind}:${prose.id}`,
          kind,
          text: prose.text,
          streaming: !snapshot,
        });
      }
      else if (event.type === "message.completed" || event.type === "reasoning.completed") {
        const prose = this.prose.get(parent);
        if (prose) output.push({ type: "agent.step", callId: parent,
          stepId: `${prose.kind}:${prose.id}`, kind: prose.kind, text: prose.text, streaming: false });
        this.prose.delete(parent);
      }
      else if (event.type === "image.generated") output.push({ ...event, agentCallId: parent });
      else if (event.type === "plan") output.push({ type: "agent.step", callId: parent,
        stepId: `plan:${event.key ?? "current"}`, kind: "message", text: event.text,
        append: event.append, streaming: event.streaming });
      // Child context meters and lifecycle notifications belong to the
      // child too; they must never replace or finish the parent's own work.
    }
    const expanded = output.flatMap((event): HarnessEvent[] => {
      if (event.type !== "agent.step" || event.kind !== "tool") return [event];
      const id = event.toolCallId!;
      return [event, ...(event.toolKind === "agent" ? this.metadata(id, params) : [])];
    });
    if (this.attached(parent)) return this.release(expanded);
    const backlog = this.pending.get(parent) ?? [];
    for (const event of expanded) {
      const index = event.type === "agent.step"
        ? backlog.findIndex((entry) => entry.type === "agent.step" && entry.callId === event.callId && entry.stepId === event.stepId)
        : -1;
      if (index < 0) backlog.push(event);
      else {
        const before = backlog[index] as Step;
        const step = event as Step;
        backlog[index] = { ...before, ...step, text: step.text || before.text,
          toolKind: step.toolKind ?? before.toolKind, status: step.status ?? before.status,
          preview: mergeToolPreview(step.preview, before.preview) };
      }
    }
    if (backlog.length > 1024) { backlog.splice(0, backlog.length - 1024); this.gaps.add(parent); }
    this.pending.set(parent, backlog);
    if (this.pending.size > 32) {
      const oldest = this.pending.keys().next().value!;
      this.pending.delete(oldest); this.gaps.add(oldest);
    }
    return [];
  }

  private attached(id: string): boolean {
    const seen = new Set<string>();
    while (this.owners.has(id)) {
      if (seen.has(id)) return false;
      seen.add(id); id = this.owners.get(id)!;
    }
    return this.tools.has(id);
  }

  private release(events: HarnessEvent[]): HarnessEvent[] {
    return events.flatMap((event): HarnessEvent[] => {
      const id = event.type === "agent.step" && event.kind === "tool" ? event.toolCallId : undefined;
      if (!id) return [event];
      const backlog = this.pending.get(id) ?? [];
      this.pending.delete(id);
      return [event, ...(this.gaps.has(id) ? [{ type: "agent.updated" as const, callId: id, coverage: "partial" as const }] : []), ...this.release(backlog)];
    });
  }

  private input(params: unknown): string | undefined {
    const envelope = record(params);
    const update = record(envelope?.update) ?? envelope;
    const tool = record(update?.toolCall) ?? record(update?.tool_call) ?? update;
    const input = tool?.rawInput ?? tool?.raw_input ?? tool?.input;
    return input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input, null, 2);
  }

  private metadata(callId: string, params: unknown): HarnessEvent[] {
    const raw = this.input(params);
    let input: Record<string, unknown> | undefined;
    try { input = raw ? record(JSON.parse(raw)) : undefined; } catch { /* Plain tool input. */ }
    const prompt = text(input?.prompt ?? input?.task);
    const model = text(input?.model);
    if (!prompt && !model && !this.gaps.has(callId)) return [];
    return [{ type: "agent.updated", callId, prompt, model,
      coverage: this.gaps.has(callId) ? "partial" : undefined }];
  }

  private parent(params: unknown): string | undefined {
    const envelope = record(params);
    const update = record(envelope?.update) ?? envelope;
    const tool = record(update?.toolCall) ?? record(update?.tool_call);
    const sources = [tool, update, envelope];
    const id = text(
      tool?.toolCallId ??
        tool?.tool_call_id ??
        update?.toolCallId ??
        update?.tool_call_id,
    );
    let parent: string | undefined;
    for (const source of sources) {
      const meta = record(source?._meta);
      for (const entry of [
        source,
        meta,
        record(meta?.cursor),
        record(meta?.grok),
        record(meta?.["x.ai"]),
        record(meta?.fx),
      ]) {
        parent = text(entry?.parentToolCallId ?? entry?.parent_tool_call_id);
        if (parent) break;
      }
      if (parent) break;
    }
    parent ??= id ? this.owners.get(id) : undefined;
    if (!parent || parent === id) return undefined;
    return parent;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Some ACP servers classify delegation as `other` and identify it in input. */
export function acpAgentInfo(
  update: Record<string, unknown>,
  tool: Record<string, unknown>,
  kind?: string,
  title?: string,
  nativeInput?: unknown,
): { kind: "agent"; title: string; agentModel?: string } | undefined {
  const input = record(
    nativeInput ??
      update.rawInput ??
      tool.rawInput ??
      update.raw_input ??
      tool.raw_input ??
      update.input ??
      tool.input,
  );
  const name = text(
    input?._toolName ?? input?.toolName ?? update.name ?? tool.name,
  );
  if (!isAgentTool(kind, title) && !(name && isAgentToolName(name)))
    return undefined;
  const model = text(input?.model);
  return {
    kind: "agent",
    title: agentToolTitle(input ?? {}, title),
    ...(model ? { agentModel: model } : {}),
  };
}
