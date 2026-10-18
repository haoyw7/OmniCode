import { translate } from "../../../../shared/i18n/language";
import {
  nativeRecord,
  nativeString,
  type NativeSessionFile,
  type NativeTranscript,
} from "../../core/nativeSessions";
import type { Block } from "../../../../features/sessions/model/session";
import {
  detailFromToolPart,
  previewFromToolPart,
  toolKindFromName,
  type OpenCodePart,
} from "./opencodeProtocol";

/** opencode names untitled sessions with a timestamp; that is not a title. */
const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/;

function toolStatus(status: string): string {
  if (status === "completed" || status === "error") return status;
  return status === "pending" || status === "running" ? "running" : "completed";
}

/**
 * Parse the normalized `{session, messages:[{info, parts}]}` document that the
 * desktop backend reads from opencode's SQLite store.
 */
export function parseOpenCodeSession(
  content: string,
  file: NativeSessionFile,
): NativeTranscript {
  let document: Record<string, unknown>;
  try {
    document = nativeRecord(JSON.parse(content));
  } catch {
    throw new Error(translate("Invalid OpenCode session data"));
  }
  const session = nativeRecord(document.session);
  if (
    session.id !== file.providerSessionId ||
    nativeString(session.directory).replace(/\\/g, "/") !== file.cwd
  )
    throw new Error(
      translate("OpenCode session identity changed; refresh the session list"),
    );
  const title = nativeString(session.title).trim();
  const result: NativeTranscript = {
    createdAt:
      typeof session.timeCreated === "number" ? session.timeCreated : file.modifiedAt,
    blocks: [],
    modelSettings: {},
    title: title && !DEFAULT_TITLE.test(title) ? title : undefined,
  };
  const sessionModel = nativeRecord(session.model);
  if (typeof sessionModel.providerID === "string" && typeof sessionModel.id === "string")
    result.model = `opencode:${sessionModel.providerID}/${sessionModel.id}`;
  const messages = Array.isArray(document.messages) ? document.messages : [];
  for (const value of messages) {
    const message = nativeRecord(value);
    const info = nativeRecord(message.info);
    const messageId = nativeString(message.id);
    const parts = (Array.isArray(message.parts) ? message.parts : []).map(nativeRecord);
    const startedAt =
      typeof message.timeCreated === "number" ? message.timeCreated : undefined;
    if (info.role === "user") {
      const text = parts
        .flatMap((part) => {
          if (part.synthetic === true || part.ignored === true) return [];
          if (part.type === "text" && typeof part.text === "string") return [part.text];
          if (part.type === "file")
            return nativeString(part.mime).startsWith("image/")
              ? [translate("[Image retained in the native session]")]
              : [nativeString(part.filename) || nativeString(part.url)];
          return [];
        })
        .filter(Boolean)
        .join("\n");
      if (text)
        result.blocks.push({
          id: `native-opencode-${messageId}`,
          role: "user",
          text,
          startedAt,
        });
      continue;
    }
    if (info.role !== "assistant") continue;
    if (typeof info.providerID === "string" && typeof info.modelID === "string")
      result.model = `opencode:${info.providerID}/${info.modelID}`;
    for (const part of parts) {
      const id = `native-opencode-${nativeString(part.id)}`;
      if (part.type === "text" && typeof part.text === "string") {
        if (part.synthetic !== true && part.text.trim())
          result.blocks.push({ id, role: "assistant", text: part.text, startedAt });
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        if (part.text.trim())
          result.blocks.push({ id, role: "reasoning", text: part.text });
      } else if (part.type === "tool") {
        const tool = part as unknown as OpenCodePart;
        const name = nativeString(part.tool) || "tool";
        const state = nativeRecord(part.state);
        const block: Block = {
          id,
          role: "tool",
          text: JSON.stringify(state.input ?? {}),
          tool: {
            callId: nativeString(part.callID) || undefined,
            title: nativeString(state.title) || name,
            kind: toolKindFromName(name),
            status: toolStatus(nativeString(state.status)),
            detail: detailFromToolPart(tool),
            preview: previewFromToolPart(tool),
          },
        };
        result.blocks.push(block);
      } else if (part.type === "compaction") {
        result.blocks.push({
          id,
          role: "system",
          text: translate("Conversation compacted"),
        });
      }
    }
    const error = nativeRecord(info.error);
    const errorMessage =
      nativeString(nativeRecord(error.data).message) || nativeString(error.message);
    if (errorMessage && error.name !== "MessageAbortedError")
      result.blocks.push({
        id: `native-opencode-${messageId}-error`,
        role: "system",
        text: errorMessage,
      });
  }
  return result;
}
