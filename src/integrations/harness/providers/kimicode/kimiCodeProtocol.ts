import type {
  HarnessEvent,
  SendTurnInput,
  UserQuestion,
  UserQuestionReply,
} from "../../core/types";

export const KIMI_AUTH_HELP =
  "Run `kimi login` in a terminal, then retry in OmniCode.";
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type ModelSettings = NonNullable<
  Extract<
    HarnessEvent,
    { type: "session.configChanged" }
  >["modelSettingOptions"]
>;
export type KimiModel = {
  id: string;
  harness: "kimicode";
  name: string;
  nativeId: string;
};
export type ConfigOption = {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: { value: string; label: string }[];
};

function choices(raw: unknown): ConfigOption["options"] {
  return Array.isArray(raw)
    ? raw.flatMap((item) => {
        const option = record(item);
        if (Array.isArray(option.options)) return choices(option.options);
        return typeof option.value === "string"
          ? [
              {
                value: option.value,
                label: String(option.name ?? option.value),
              },
            ]
          : [];
      })
    : [];
}

export function kimiConfigOptions(raw: unknown): ConfigOption[] {
  return Array.isArray(raw)
    ? raw.flatMap((item) => {
        const option = record(item);
        return typeof option.id === "string" &&
          typeof option.currentValue === "string"
          ? [
              {
                id: option.id,
                name: String(option.name ?? option.id),
                category:
                  typeof option.category === "string"
                    ? option.category
                    : undefined,
                currentValue: option.currentValue,
                options: choices(option.options),
              },
            ]
          : [];
      })
    : [];
}

export function kimiModelOption(
  options: ConfigOption[],
): ConfigOption | undefined {
  return (
    options.find((option) => option.id === "model") ??
    options.find((option) => option.category === "model")
  );
}

export function modelsFromKimiSession(setup: unknown): KimiModel[] {
  const rec = record(setup);
  const model = kimiModelOption(kimiConfigOptions(rec.configOptions));
  const legacy = record(rec.models);
  const available =
    model?.options ??
    (Array.isArray(legacy.availableModels)
      ? legacy.availableModels.flatMap((item) => {
          const value = record(item);
          return typeof value.modelId === "string"
            ? [
                {
                  value: value.modelId,
                  label: String(value.name ?? value.modelId),
                },
              ]
            : [];
        })
      : []);
  const current = model?.currentValue ?? legacy.currentModelId;
  const models = [
    ...new Map(
      available.map(({ value, label }) => [
        value,
        {
          id: `kimicode:${value}`,
          harness: "kimicode" as const,
          name: label,
          nativeId: value,
        },
      ]),
    ).values(),
  ];
  const index = models.findIndex((item) => item.nativeId === current);
  if (index > 0) models.unshift(...models.splice(index, 1));
  return models;
}

export function kimiSettings(
  options: ConfigOption[],
  modelId: string,
): ModelSettings {
  return {
    model: `kimicode:${modelId}`,
    settings: options
      .filter(
        (option) =>
          option.category === "thought_level" || option.id === "thinking",
      )
      .map((option) => ({
        id: option.id,
        label: option.name,
        kind: "select" as const,
        value: option.currentValue,
        options: option.options,
      })),
  };
}

export function kimiMode(
  input: Pick<SendTurnInput, "runtimeMode" | "intent">,
): string {
  if (input.intent === "plan") return "plan";
  // Native `auto` also approves safe commands; OmniCode's edit-only mode
  // keeps Kimi manual and decides individual permission requests below.
  return input.runtimeMode === "full-access" ? "yolo" : "default";
}

export function kimiPermissionOption(
  params: unknown,
  allow: boolean,
): string | undefined {
  const options = record(params).options;
  if (!Array.isArray(options)) return;
  const kinds = allow
    ? ["allow_once", "allow_always"]
    : ["reject_once", "reject_always"];
  for (const kind of kinds) {
    const option = options
      .map(record)
      .find((item) => item.kind === kind && typeof item.optionId === "string");
    if (option) return option.optionId as string;
  }
}

/** Kimi's reverse permission RPC omits kind, unlike its tool stream updates. */
export function kimiPermissionKind(params: unknown): string | undefined {
  const tool = record(record(params).toolCall);
  if (typeof tool.kind === "string") return tool.kind;
  const kinds: Record<string, string> = {
    Read: "read",
    Glob: "search",
    Grep: "search",
    Write: "edit",
    Edit: "edit",
    Bash: "execute",
    Terminal: "execute",
    WebFetch: "fetch",
    WebSearch: "fetch",
    Think: "think",
  };
  return kinds[String(tool.title ?? "")];
}

export type KimiQuestion = {
  title: string;
  questions: UserQuestion[];
  callId?: string;
  permission: boolean;
};

/** Kimi Code's full form bridge, plus the documented permission fallback. */
export function kimiQuestion(
  method: string,
  params: unknown,
): KimiQuestion | null {
  const rec = record(params);
  if (method === "session/request_permission") {
    const options = Array.isArray(rec.options) ? rec.options.map(record) : [];
    const answers = options.filter(
      (item) =>
        typeof item.optionId === "string" &&
        /^(?:q\d+_opt_\d+|plan_(?:opt_\d+|approve|revise|reject_and_exit))$/.test(
          item.optionId,
        ),
    );
    if (answers.length === 0) return null;
    const tool = record(rec.toolCall);
    const content = Array.isArray(tool.content)
      ? tool.content
          .map((item) => record(record(item).content).text)
          .filter((item) => typeof item === "string")
          .join("\n")
      : "";
    const title = content || String(tool.title ?? "Question");
    return {
      title,
      callId: typeof tool.toolCallId === "string" ? tool.toolCallId : undefined,
      permission: true,
      questions: [
        {
          id: "q0",
          prompt: title,
          multiSelect: false,
          allowCustom: false,
          options: answers.map((item) => ({
            id: String(item.optionId),
            label: String(item.name ?? item.optionId),
          })),
        },
      ],
    };
  }
  if (method !== "elicitation/create" || rec.mode !== "form") return null;
  const properties = record(record(rec.requestedSchema).properties);
  const questions: UserQuestion[] = [];
  for (const [id, raw] of Object.entries(properties)) {
    const field = record(raw);
    if (field.type !== "string" && field.type !== "array") return null;
    const schema = field.type === "array" ? record(field.items) : field;
    const enums = schema.oneOf ?? schema.anyOf;
    const options = Array.isArray(enums)
      ? enums.flatMap((item) => {
          const value = record(item);
          return typeof value.const === "string"
            ? [
                {
                  id: value.const,
                  label: String(value.title ?? value.const),
                  ...(typeof value.description === "string"
                    ? { description: value.description }
                    : {}),
                },
              ]
            : [];
        })
      : Array.isArray(schema.enum)
        ? schema.enum
            .filter((item): item is string => typeof item === "string")
            .map((item) => ({ id: item, label: item }))
        : [];
    const title = String(field.title ?? rec.message ?? id);
    questions.push({
      id,
      header: title,
      prompt:
        typeof field.description === "string"
          ? `${title}\n${field.description}`
          : title,
      multiSelect: field.type === "array",
      allowCustom: field.type === "string" && options.length === 0,
      options,
      ...(field.type === "string" && options.length === 0
        ? { input: { kind: "text" as const } }
        : {}),
    });
  }
  return questions.length
    ? {
        title: String(rec.message ?? questions[0].prompt),
        questions,
        permission: false,
        callId: typeof rec.toolCallId === "string" ? rec.toolCallId : undefined,
      }
    : null;
}

export function kimiQuestionResponse(
  question: KimiQuestion,
  reply: UserQuestionReply,
): unknown {
  if (reply.kind === "skipped")
    return question.permission
      ? { outcome: { outcome: "cancelled" } }
      : { action: "decline" };
  if (question.permission) {
    const selected = reply.answers.q0?.find((id) =>
      question.questions[0].options.some((option) => option.id === id),
    );
    return {
      outcome: selected
        ? { outcome: "selected", optionId: selected }
        : { outcome: "cancelled" },
    };
  }
  const content: Record<string, string | string[]> = {};
  for (const field of question.questions) {
    const selected = (reply.answers[field.id] ?? []).filter((id) =>
      field.options.some((option) => option.id === id),
    );
    if (field.multiSelect) content[field.id] = selected;
    else if (selected.length) content[field.id] = selected[0];
    else if (field.allowCustom && reply.custom?.[field.id] != null)
      content[field.id] = reply.custom[field.id];
  }
  return { action: "accept", content };
}
