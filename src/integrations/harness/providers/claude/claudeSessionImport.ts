import { translate } from "../../../../shared/i18n/language";
import {
  nativeJsonLines,
  nativeRecord,
  nativeString,
  nativeText,
  type NativeSessionFile,
  type NativeTranscript,
} from "../../core/nativeSessions";
import { claudeNativeTitleFromRows } from "../../core/nativeTitleParsing";
import type { Block } from "../../../../features/sessions/model/session";

type Row = Record<string, unknown>;

/** Claude stores CLI-internal turns as XML-like wrappers around user rows. */
function commandText(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("<")) return text;
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(trimmed)?.[1];
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(trimmed)?.[1];
    return [name.trim(), args?.trim()].filter(Boolean).join(" ");
  }
  // Command output, caveats and background notifications are CLI chrome.
  if (
    /^<(local-command-stdout|local-command-stderr|local-command-caveat|command-message|task-notification|system-reminder)>/.test(
      trimmed,
    )
  )
    return null;
  return text;
}

const conversational = (row: Row) =>
  row.isSidechain !== true &&
  typeof row.uuid === "string" &&
  (row.type === "user" || row.type === "assistant" || row.type === "system");

/** Follow the active branch back from the newest conversational row. */
function activePath(rows: Row[]): Row[] {
  const byId = new Map<string, Row>();
  for (const row of rows)
    if (row.isSidechain !== true && typeof row.uuid === "string")
      byId.set(row.uuid, row);
  let leaf: Row | undefined;
  for (let index = rows.length - 1; index >= 0 && !leaf; index--)
    if (conversational(rows[index])) leaf = rows[index];
  const path: Row[] = [];
  const visited = new Set<string>();
  while (leaf) {
    const id = nativeString(leaf.uuid);
    if (visited.has(id))
      throw new Error(translate("Invalid Claude session tree: cycle"));
    visited.add(id);
    path.push(leaf);
    // A compact boundary starts a new chain but keeps the earlier one as its logical parent.
    const parent = nativeString(leaf.parentUuid) || nativeString(leaf.logicalParentUuid);
    leaf = parent ? byId.get(parent) : undefined;
  }
  return path.reverse();
}

export function parseClaudeSession(
  content: string,
  file: NativeSessionFile,
): NativeTranscript {
  const rows = nativeJsonLines(content);
  // Claude resumes by file name, so the file is the identity; its project must not move.
  const located = rows.find(
    (row) => row.isSidechain !== true && typeof row.cwd === "string",
  );
  if (
    !file.path.endsWith(`/${file.providerSessionId}.jsonl`) ||
    nativeString(located?.cwd).replace(/\\/g, "/") !== file.cwd
  )
    throw new Error(
      translate("Claude session identity changed; refresh the session list"),
    );
  const firstTimestamp = rows
    .map((row) => Date.parse(nativeString(row.timestamp)))
    .find(Number.isFinite);
  const result: NativeTranscript = {
    createdAt: firstTimestamp ?? file.modifiedAt,
    blocks: [],
    modelSettings: {},
  };
  const legacySummary = rows.find((row) => row.type === "summary");
  result.title =
    claudeNativeTitleFromRows(rows, file.providerSessionId) ??
    (typeof legacySummary?.summary === "string" ? legacySummary.summary : undefined);
  const calls = new Map<string, Block>();
  let previous: { messageId: string; block: Block } | undefined;
  for (const row of activePath(rows)) {
    const id = `native-claude-${nativeString(row.uuid)}`;
    const message = nativeRecord(row.message);
    const startedAt = Date.parse(nativeString(row.timestamp)) || undefined;
    if (row.type === "system") {
      previous = undefined;
      if (row.subtype === "compact_boundary")
        result.blocks.push({
          id,
          role: "system",
          text: translate("Conversation compacted"),
        });
      continue;
    }
    if (row.type === "user") {
      previous = undefined;
      if (row.isMeta === true) continue;
      if (row.isCompactSummary === true) {
        const text = nativeText(message.content);
        if (text) result.blocks.push({ id, role: "system", text });
        continue;
      }
      const parts = Array.isArray(message.content) ? message.content : [];
      for (const value of parts) {
        const part = nativeRecord(value);
        if (part.type !== "tool_result") continue;
        const text = nativeText(part.content);
        const block = calls.get(nativeString(part.tool_use_id));
        if (block)
          block.tool = {
            ...block.tool,
            detail: text,
            status: part.is_error === true ? "error" : "completed",
          };
      }
      const raw = nativeText(
        typeof message.content === "string"
          ? message.content
          : parts.filter((part) => nativeRecord(part).type !== "tool_result"),
      );
      const text = raw ? commandText(raw) : null;
      if (text) result.blocks.push({ id, role: "user", text, startedAt });
      continue;
    }
    // Claude writes one row per content block; rows of one API message share `message.id`.
    const messageId = nativeString(message.id);
    if (typeof message.model === "string" && message.model !== "<synthetic>")
      result.model = `claude:${message.model.replace(/^claude-/, "")}`;
    const content = Array.isArray(message.content) ? message.content : [];
    for (let index = 0; index < content.length; index++) {
      const part = nativeRecord(content[index]);
      if (part.type === "text" && typeof part.text === "string") {
        if (!part.text.trim()) continue;
        if (
          previous &&
          previous.messageId === messageId &&
          messageId &&
          previous.block.role === "assistant"
        ) {
          previous.block.text += `\n\n${part.text}`;
          if (startedAt != null) previous.block.sentAt = startedAt;
          continue;
        }
        const block: Block = {
          id: index === 0 ? id : `${id}-text-${index}`,
          role: "assistant",
          text: part.text,
          startedAt,
        };
        result.blocks.push(block);
        previous = { messageId, block };
        continue;
      }
      previous = undefined;
      if (part.type === "thinking" && typeof part.thinking === "string") {
        if (part.thinking.trim())
          result.blocks.push({
            id: `${id}-thinking-${index}`,
            role: "reasoning",
            text: part.thinking,
          });
      } else if (part.type === "tool_use") {
        const callId = nativeString(part.id);
        const block: Block = {
          id: `${id}-tool-${index}`,
          role: "tool",
          text: JSON.stringify(part.input ?? {}),
          tool: {
            callId,
            title: nativeString(part.name),
            status: "completed",
          },
        };
        calls.set(callId, block);
        result.blocks.push(block);
      }
    }
  }
  return result;
}
