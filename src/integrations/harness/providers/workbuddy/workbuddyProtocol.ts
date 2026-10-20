import type { HarnessEvent, SendTurnInput } from "../../core/types";
import type { HarnessAdapter } from "../../core/registry";
import { translate } from "../../../../shared/i18n/language";

export type Json = Record<string, any>;
export type Question = Extract<HarnessEvent, { type: "question.asked" }>["questions"][number];
export type QuestionReply = Parameters<NonNullable<HarnessAdapter["respondQuestion"]>>[2];

export function parseLine(line: string): Json | null {
  try { const value: unknown = JSON.parse(line); return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null; }
  catch { return null; }
}
export function workBuddyModel(model: string): { edition: "cn" | "global"; nativeId: string } {
  const match = /^workbuddy:(cn|global):(.+)$/.exec(model);
  if (!match) throw new Error(translate("Select a WorkBuddy model for the account region"));
  return { edition: match[1] as "cn" | "global", nativeId: match[2] };
}
export function permissionMode(mode: SendTurnInput["runtimeMode"], intent?: SendTurnInput["intent"]): string {
  if (intent === "plan") return "plan";
  return { supervised: "default", "auto-accept-edits": "acceptEdits", auto: "auto", "full-access": "bypassPermissions" }[mode];
}
export function spawnArgs(input: SendTurnInput, resume?: string): string[] {
  const model = workBuddyModel(input.model);
  return ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--replay-user-messages", "--model", model.nativeId, "--permission-mode", permissionMode(input.runtimeMode, input.intent),
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', ...(resume ? ["--resume", resume] : [])];
}
export function control(requestId: string, request: Json): Json {
  return { type: "control_request", request_id: requestId, request };
}
export function permissionResponse(requestId: string, allowed: boolean, input?: Json, reason?: string): Json {
  return { type: "control_response", response: { subtype: "success", request_id: requestId,
    response: { allowed, ...(input ? { updatedInput: input } : {}), ...(!allowed ? { reason: reason || "User declined tool execution." } : {}) } } };
}
export function userMessage(input: Pick<SendTurnInput, "text" | "attachments">, uuid: string): Json {
  const content: Json[] = input.text ? [{ type: "text", text: input.text }] : [];
  for (const file of input.attachments || []) {
    if (file.kind === "image") {
      const mime = file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType;
      if (!file.data || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) throw new Error(translate("This image cannot be sent to WorkBuddy"));
      content.push({ type: "image", source: { type: "base64", media_type: mime, data: file.data } });
    } else content.push({ type: "text", text: file.path ? `Attached file: ${file.path}` : `Attached file: ${file.name}` });
  }
  return { type: "user", uuid, message: { role: "user", content } };
}
export function questions(input: Json): Question[] {
  if (!Array.isArray(input.questions)) return [];
  const used = new Set<string>();
  return input.questions.flatMap((q: Json, index: number) => {
    if (!q || typeof q.question !== "string" || !q.question) return [];
    let id = typeof q.id === "string" ? q.id : q.question;
    if (used.has(id)) id += ":" + index;
    used.add(id);
    return [{ id, prompt: q.question, ...(typeof q.header === "string" ? { header: q.header } : {}),
      multiSelect: q.multiSelect === true, allowCustom: true,
      options: Array.isArray(q.options) ? q.options.flatMap((option: Json | string, i: number) => {
        const label = typeof option === "string" ? option : option?.label;
        return typeof label === "string" ? [{ id: String(i), label, ...(typeof option === "object" && typeof option.description === "string" ? { description: option.description } : {}) }] : [];
      }) : [] }];
  });
}
export function questionInput(input: Json, reply: QuestionReply): Json | undefined {
  if (reply.kind !== "answered") return undefined;
  const answers: Record<string, string> = {};
  for (const q of questions(input)) {
    const custom = reply.custom?.[q.id]?.trim();
    const labels = (reply.answers[q.id] || []).flatMap(id => {
      const option = q.options.find(o => o.id === id);
      return option ? [option.label] : custom ? [custom] : [];
    });
    if (!labels.length && custom) labels.push(custom);
    if (labels.length) answers[q.prompt] = q.multiSelect ? labels.join(", ") : labels[0];
  }
  return Object.keys(answers).length ? { ...input, answers } : undefined;
}
export function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.filter(p => p?.type === "text" && typeof p.text === "string").map(p => p.text).join("\n") : "";
}
export function toolKind(name: string): string {
  if (["Read", "Glob", "Grep"].includes(name)) return "read";
  if (["Write", "Edit", "NotebookEdit"].includes(name)) return "edit";
  if (["Bash", "PowerShell"].includes(name)) return "command";
  if (["WebSearch", "WebFetch"].includes(name)) return "search";
  return "tool";
}
export function toolPreview(name: string, input: Json): Extract<HarnessEvent, { type: "tool.started" }>["preview"] {
  if (typeof input.file_path === "string") return { kind: ["Write", "Edit"].includes(name) ? "write" : "read", path: input.file_path,
    ...(typeof input.content === "string" ? { contentOnly: true, lines: input.content.split("\n").map(text => ({ kind: "add" as const, text })) } : {}) };
  if (typeof input.command === "string") return { kind: "shell", title: input.command };
  return undefined;
}
export function isHistorical(message: Json, sentAt: number): boolean {
  const stamp = typeof message.__timestamp === "string" ? Date.parse(message.__timestamp) : NaN;
  return Number.isFinite(stamp) && stamp < sentAt;
}
