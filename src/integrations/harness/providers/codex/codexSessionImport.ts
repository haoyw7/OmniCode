import { translate } from "../../../../shared/i18n/language";
import {
  nativeJsonLines,
  nativeRecord,
  nativeString,
  nativeText,
  type NativeSessionFile,
  type NativeTranscript,
} from "../../core/nativeSessions";
import type { Block } from "../../../../features/sessions/model/session";

export function parseCodexSession(
  content: string,
  file: NativeSessionFile,
): NativeTranscript {
  const records = nativeJsonLines(content);
  const header = nativeRecord(records[0]?.payload);
  if (
    records[0]?.type !== "session_meta" ||
    header.id !== file.providerSessionId ||
    nativeString(header.cwd).replace(/\\/g, "/") !== file.cwd
  )
    throw new Error(
      translate("Codex session identity changed; refresh the session list"),
    );
  const hasUserEvents = records.some(
    (row) =>
      row.type === "event_msg" &&
      nativeRecord(row.payload).type === "user_message",
  );
  const result: NativeTranscript = {
    createdAt: Date.parse(nativeString(header.timestamp)) || file.modifiedAt,
    blocks: [],
    modelSettings: {},
  };
  const calls = new Map<string, Block>();
  let user: Block | undefined;
  let turnId: string | undefined;
  for (let index = 1; index < records.length; index++) {
    const row = records[index];
    const payload = nativeRecord(row.payload);
    const id = `native-codex-${index}`;
    if (row.type === "turn_context") {
      if (typeof payload.model === "string")
        result.model = `codex:${payload.model}`;
      if (typeof payload.effort === "string")
        result.modelSettings.reasoningEffort = payload.effort;
      continue;
    }
    if (row.type === "event_msg") {
      if (payload.type === "user_message") {
        user = {
          id,
          role: "user",
          providerTurnId: turnId,
          text: nativeString(payload.message),
          startedAt: Date.parse(nativeString(row.timestamp)) || undefined,
        };
        result.blocks.push(user);
      } else if (
        payload.type === "task_started" &&
        typeof payload.turn_id === "string"
      ) {
        turnId = payload.turn_id;
        if (user && !user.providerTurnId) user.providerTurnId = turnId;
      }
      continue;
    }
    if (row.type !== "response_item") continue;
    if (payload.type === "message") {
      const role = payload.role;
      if (role !== "assistant" && (role !== "user" || hasUserEvents)) continue;
      const text = nativeText(payload.content);
      if (!text) continue;
      const block: Block = {
        id, role, text,
        startedAt: Date.parse(nativeString(row.timestamp)) || undefined,
      };
      result.blocks.push(block);
      if (role === "user") user = block;
    } else if (payload.type === "reasoning") {
      const text = nativeText(payload.summary);
      if (text) result.blocks.push({ id, role: "reasoning", text });
    } else if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call"
    ) {
      const callId = nativeString(payload.call_id);
      const block: Block = {
        id,
        role: "tool",
        text: nativeString(payload.arguments ?? payload.input),
        tool: {
          callId,
          title: nativeString(payload.name),
          status: "completed",
        },
      };
      calls.set(callId, block);
      result.blocks.push(block);
    } else if (
      payload.type === "function_call_output" ||
      payload.type === "custom_tool_call_output"
    ) {
      const block = calls.get(nativeString(payload.call_id));
      const text = nativeText(payload.output);
      if (block) block.tool = { ...block.tool, detail: text };
      else if (text)
        result.blocks.push({
          id,
          role: "tool",
          text,
          tool: { status: "completed" },
        });
    }
  }
  return result;
}
