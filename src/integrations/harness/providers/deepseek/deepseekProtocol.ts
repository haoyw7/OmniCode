import type {
  AgentModel,
  Attachment,
  HarnessEvent,
  UserQuestion,
  UserQuestionReply,
} from "../../core/types";
import { extractToolPreview, titleFromToolInput } from "../../core/preview";
import { translate } from "../../../../shared/i18n/language";

export const DEEPSEEK_BRIDGE_PROTOCOL = 1;
export const DEEPSEEK_RUNTIME_VERSION = "0.2.1-rc.2";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek:default";
export type BridgeRecord = Record<string, any>;
export const asRecord = (value: unknown): BridgeRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as BridgeRecord)
    : {};

const applicationErrors = new Set([
  "DeepSeek Harness profile omnicode-v1 is not owned by OmniCode",
  "The selected DeepSeek model does not accept images",
  "DeepSeek session workspace does not match",
  "DeepSeek question is no longer answerable",
  "Wait for the active run before changing DeepSeek configuration",
  "DeepSeek assistant stream has a missing chunk",
  "DeepSeek committed content differs from its live stream",
]);
export function deepseekErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const version = message.match(
    /^DeepSeek Harness bridge requires dsh ([^;\r\n]+); found ([^\r\n]*)/,
  );
  if (version)
    return (
      translate("DeepSeek Harness requires dsh {version}; found {actual}", {
        version: version[1],
        actual: version[2],
      }) + message.slice(version[0].length)
    );
  return applicationErrors.has(message) ? translate(message) : message;
}

export function deepseekSelection(
  model: string,
  settings?: Record<string, string>,
) {
  const native = model.replace(/^deepseek:/, "");
  let route: unknown;
  try {
    route = JSON.parse(native);
  } catch {
    /* The built-in default is resolved by the runtime. */
  }
  const [provider, id] =
    Array.isArray(route) &&
    route.length === 2 &&
    route.every((value) => typeof value === "string" && value)
      ? route
      : [
          "deepseek-official",
          native === "default" ? "deepseek-v4-flash" : native,
        ];
  return {
    provider,
    model: id,
    ...(settings?.reasoning_effort
      ? { reasoningEffort: settings.reasoning_effort }
      : {}),
  };
}

export function deepseekModels(catalog: unknown): AgentModel[] {
  if (!Array.isArray(catalog)) return [];
  return catalog.flatMap((value) => {
    const group = asRecord(value);
    if (typeof group.id !== "string" || !Array.isArray(group.models)) return [];
    return group.models.flatMap((value: unknown) => {
      const model = asRecord(value);
      if (typeof model.id !== "string") return [];
      const nativeId = JSON.stringify([group.id, model.id]);
      const reasoning = asRecord(model.reasoning);
      const efforts = Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
      return [
        {
          id: `deepseek:${nativeId}`,
          harness: "deepseek" as const,
          nativeId,
          name: model.name || model.id,
          provider: { id: group.id, name: group.name || group.id },
          ...(efforts.length
            ? {
                settings: [
                  {
                    id: "reasoning_effort",
                    label: translate("Reasoning effort"),
                    kind: "select" as const,
                    value: "",
                    options: [
                      { value: "", label: translate("Provider default") },
                      ...efforts.map((effort: BridgeRecord) => ({
                        value: effort.id,
                        label: effort.name || effort.id,
                      })),
                    ],
                  },
                ],
              }
            : {}),
        },
      ];
    });
  });
}

export function deepseekContent(text: string, attachments: Attachment[] = []) {
  const files = attachments
    .filter((file) => file.kind !== "image")
    .map(
      (file) =>
        `[Attached file: ${file.name}${file.path ? ` (${file.path})` : ""}]`,
    );
  const content: BridgeRecord[] = [];
  const body = [text, ...files].filter(Boolean).join("\n\n");
  if (body) content.push({ type: "text", text: body });
  for (const image of attachments.filter((file) => file.kind === "image")) {
    if (!image.data && !image.path)
      throw new Error(translate("Image attachment has no readable content"));
    content.push({
      type: "image",
      mimeType: image.mimeType,
      ...(image.data
        ? { data: image.data.replace(/^data:[^;]+;base64,/, "") }
        : { path: image.path }),
    });
  }
  return content;
}

export function deepseekQuestions(value: unknown): UserQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.map((value, index) => {
    const question = asRecord(value);
    return {
      id: String(question.id ?? index),
      prompt: String(question.question ?? ""),
      ...(question.header ? { header: question.header } : {}),
      ...(question.detail ? { detail: String(question.detail) } : {}),
      ...(question.intent ? { intent: question.intent } : {}),
      multiSelect: question.multiSelect === true,
      allowCustom: true,
      options: Array.isArray(question.options)
        ? question.options.map((option: BridgeRecord) => ({
            id: option.label,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          }))
        : [],
    };
  });
}

export function deepseekAnswer(reply: UserQuestionReply) {
  return reply.kind === "answered"
    ? { answers: reply.answers, custom: reply.custom ?? {} }
    : { answers: {}, custom: {} };
}

function toolKind(name: string): string {
  if (["write", "edit"].includes(name)) return "edit";
  if (["read", "read_image"].includes(name)) return "read";
  if (["glob", "grep", "web_search"].includes(name)) return "search";
  if (["bash", "pwsh", "run_code"].includes(name)) return "execute";
  if (/agent|delegate/.test(name)) return "agent";
  return "other";
}

/** Fold transient attempts and committed facts without appending completion snapshots twice. */
export class DeepseekEventMapper {
  private readonly streams = new Map<
    string,
    {
      key: string;
      index: number;
      text: string;
      reasoning: string;
      turn: number;
      step: number;
    }
  >();
  private readonly steps = new Map<
    string,
    { key: string; text: string; reasoning: string }
  >();
  private readonly sequences = new Map<string, number>();
  private readonly failedAgents = new Set<string>();
  private usage: Partial<
    Record<
      "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens",
      number
    >
  > = {};
  readonly tools = new Map<
    string,
    Extract<HarnessEvent, { type: "tool.started" }>
  >();
  tool(source: string, callId: string) {
    return this.tools.get(`${source}:${callId}`);
  }

  events(params: unknown, root: string): HarnessEvent[] {
    const envelope = asRecord(params);
    const source = String(envelope.sourceSessionId ?? root);
    const child = source !== root;
    const data = asRecord(envelope.data);
    const events: HarnessEvent[] = [];
    if (envelope.kind === "assistant.stream") {
      const key = `${source}:${data.attemptId}`;
      if (data.type === "start") {
        if (this.streams.has(key)) return [];
        const state = {
          key,
          index: 0,
          text: "",
          reasoning: "",
          turn: data.turn,
          step: data.step,
        };
        this.streams.set(key, state);
        this.steps.set(`${source}:${data.turn}:${data.step}`, state);
        if (this.streams.size > 256)
          this.streams.delete(this.streams.keys().next().value!);
        if (this.steps.size > 256)
          this.steps.delete(this.steps.keys().next().value!);
        if (!child)
          events.push(
            { type: "message.completed" },
            { type: "reasoning.completed" },
          );
      } else if (data.type === "chunk") {
        const state = this.streams.get(key);
        if (!state || data.index < state.index) return [];
        if (data.index !== state.index)
          throw new Error("DeepSeek assistant stream has a missing chunk");
        state.index++;
        const chunk = asRecord(data.chunk);
        if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
          const text = String(chunk.text ?? "");
          if (chunk.type === "text-delta") state.text += text;
          else state.reasoning += text;
          if (child)
            events.push({
              type: "agent.step",
              callId: `dsh-agent:${source}`,
              stepId: `${key}:${chunk.type === "text-delta" ? "text" : "reasoning"}`,
              kind: chunk.type === "text-delta" ? "message" : "reasoning",
              text,
              append: true,
              streaming: true,
            });
          else
            events.push({
              type:
                chunk.type === "text-delta"
                  ? "message.delta"
                  : "reasoning.delta",
              text,
            });
        }
      } else if (data.type === "end") {
        if (!child)
          events.push(
            { type: "message.completed" },
            { type: "reasoning.completed" },
          );
        else
          for (const kind of ["text", "reasoning"] as const) {
            if (!this.streams.get(key)?.[kind]) continue;
            events.push({
              type: "agent.step",
              callId: `dsh-agent:${source}`,
              stepId: `${key}:${kind}`,
              kind: kind === "text" ? "message" : "reasoning",
              text: "",
              append: true,
              streaming: false,
            });
          }
      }
      return events;
    }
    if (envelope.kind === "image")
      return [
        {
          type: "image.generated",
          itemId: data.itemId,
          data: data.data,
          name: data.name,
          mimeType: data.mimeType,
          ...(child ? { agentCallId: `dsh-agent:${source}` } : {}),
        },
      ];
    if (envelope.kind === "jobs")
      return [
        {
          type: "background.updated",
          tasks: (data.jobs ?? []).map((job: BridgeRecord) =>
            String(job.label ?? job.id),
          ),
        },
      ];
    if (envelope.kind === "agent.started")
      return [
        {
          type: "tool.started",
          callId: `dsh-agent:${source}`,
          title: translate("Subagent"),
          kind: "agent",
          status: "in_progress",
        },
        {
          type: "agent.updated",
          callId: `dsh-agent:${source}`,
          providerSessionId: source,
        },
      ];
    if (envelope.kind === "agent.finished")
      return [
        {
          type: "tool.updated",
          callId: `dsh-agent:${source}`,
          status: this.failedAgents.has(source) ? "failed" : "completed",
        },
      ];
    if (envelope.kind === "agent.status") {
      if (data.status === "running") this.failedAgents.delete(source);
      return [
        {
          type: "tool.updated",
          callId: `dsh-agent:${source}`,
          status:
            data.status === "running"
              ? "in_progress"
              : this.failedAgents.has(source)
                ? "failed"
                : "completed",
        },
      ];
    }
    if (envelope.kind === "agent.error") {
      this.failedAgents.add(source);
      return [
        {
          type: "tool.updated",
          callId: `dsh-agent:${source}`,
          status: "failed",
          detail: String(data.message ?? ""),
        },
      ];
    }
    if (envelope.kind !== "durable") return [];
    if (typeof data.seq === "number") {
      if (data.seq <= (this.sequences.get(source) ?? -1)) return [];
      this.sequences.set(source, data.seq);
    }
    const payload = asRecord(data.data);
    if (data.type === "turn/start" && !child) {
      this.usage = {};
      events.push({
        type: "turn.started",
        providerTurnId: `${root}:${payload.turn}`,
      });
    }
    if (data.type === "assistant/message") {
      const streamed = this.steps.get(
        `${source}:${payload.turn}:${payload.step}`,
      );
      for (const kind of ["text", "reasoning"] as const) {
        const snapshot = (payload.message?.content ?? [])
          .filter((block: BridgeRecord) => block.type === kind)
          .map((block: BridgeRecord) => block.text ?? "")
          .join("");
        const prefix = kind === "text" ? streamed?.text : streamed?.reasoning;
        if (prefix && !snapshot.startsWith(prefix))
          throw new Error(
            "DeepSeek committed content differs from its live stream",
          );
        const text = snapshot.slice(prefix?.length ?? 0);
        if (!text) continue;
        if (!child)
          events.push({
            type: kind === "text" ? "message.delta" : "reasoning.delta",
            text,
          });
        else
          events.push({
            type: "agent.step",
            callId: `dsh-agent:${source}`,
            stepId: `${streamed?.key ?? `${source}:${payload.turn}:${payload.step}`}:${kind}`,
            kind: kind === "text" ? "message" : "reasoning",
            text,
            append: true,
            streaming: false,
          });
      }
      if (!child && payload.usage) {
        for (const key of [
          "inputTokens",
          "outputTokens",
          "cacheReadTokens",
          "cacheWriteTokens",
        ] as const) {
          const value = payload.usage[key];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            this.usage[key] = (this.usage[key] ?? 0) + value;
        }
        events.push({ type: "turn.metrics", ...this.usage });
      }
    }
    if (data.type === "tool/call") {
      let input: BridgeRecord = {};
      try {
        input = asRecord(JSON.parse(payload.arguments));
      } catch {
        /* Preserve the provider's malformed input in the durable log. */
      }
      const kind = toolKind(payload.name);
      const callId = `${source}:${payload.callId}`;
      const event: Extract<HarnessEvent, { type: "tool.started" }> = {
        type: "tool.started",
        callId,
        title: titleFromToolInput(payload.name, kind, input),
        kind,
        status: "in_progress",
        preview: extractToolPreview(
          { rawInput: input, kind, title: payload.name },
          { rawInput: input },
        ),
      };
      this.tools.set(callId, event);
      if (this.tools.size > 512)
        this.tools.delete(this.tools.keys().next().value!);
      if (!child) events.push(event);
      else
        events.push({
          type: "agent.step",
          callId: `dsh-agent:${source}`,
          stepId: callId,
          toolCallId: payload.callId,
          kind: "tool",
          toolKind: kind,
          text: event.title,
          status: "in_progress",
        });
    }
    if (data.type === "tool/result") {
      const message = asRecord(payload.message);
      const detail = (message.content ?? [])
        .filter((block: BridgeRecord) => block.type === "text")
        .map((block: BridgeRecord) => block.text)
        .join("\n");
      const callId = `${source}:${message.toolCallId}`;
      const tool = this.tools.get(callId);
      const preview = extractToolPreview(
        {
          kind: tool?.kind,
          title: tool?.title,
          content: payload.meta?.diffs?.map((diff: BridgeRecord) => ({
            type: "diff",
            ...diff,
          })),
        },
        {},
      );
      if (!child)
        events.push({
          type: "tool.updated",
          callId,
          status: message.isError ? "failed" : "completed",
          detail,
          ...(preview ? { preview } : {}),
        });
      else
        events.push({
          type: "agent.step",
          callId: `dsh-agent:${source}`,
          stepId: callId,
          toolCallId: message.toolCallId,
          kind: "tool",
          text: tool?.title ?? translate("Tool"),
          detail,
          status: message.isError ? "failed" : "completed",
          ...(preview ? { preview } : {}),
        });
    }
    if (data.type === "todo/write" && !child) {
      const items = payload.items ?? payload.todos;
      if (Array.isArray(items))
        events.push({
          type: "tasks.updated",
          authoritative: true,
          providerSessionId: root,
          items: items.map((item: BridgeRecord, index: number) => ({
            id: String(item.id ?? index),
            text: String(item.text ?? item.content ?? item.title ?? ""),
            status: [
              "pending",
              "in_progress",
              "completed",
              "cancelled",
            ].includes(item.status)
              ? item.status
              : "pending",
          })),
        });
    }
    return events;
  }
}
