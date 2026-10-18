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

/**
 * Pi v3 session trees. omp (a Pi fork) writes the same tree with a padded
 * `title` record before the header, rewrites that record in place, and stores
 * model changes as one `provider/model` string.
 */
export function parsePiSession(
  content: string,
  file: NativeSessionFile,
): NativeTranscript {
  const omp = file.provider === "omp";
  const all = nativeJsonLines(content);
  const records = omp ? all.filter((record) => record.type !== "title") : all;
  const header = records[0];
  if (
    header?.type !== "session" ||
    header.version !== 3 ||
    header.id !== file.providerSessionId ||
    nativeString(header.cwd).replace(/\\/g, "/") !== file.cwd
  )
    throw new Error(
      omp
        ? translate("Unsupported or changed omp session; refresh the session list")
        : translate("Unsupported or changed Pi session; refresh the session list"),
    );
  const prefix = omp ? "omp" : "pi";
  const entries = records.slice(1);
  const byId = new Map(
    entries
      .filter((entry) => typeof entry.id === "string")
      .map((entry) => [entry.id, entry]),
  );
  const path: typeof entries = [];
  const visited = new Set<unknown>();
  let leaf = entries[entries.length - 1];
  while (leaf) {
    if (visited.has(leaf.id))
      throw new Error(translate("Invalid Pi session tree: cycle"));
    visited.add(leaf.id);
    path.push(leaf);
    if (leaf.parentId == null) break;
    const parent = byId.get(leaf.parentId);
    if (!parent)
      throw new Error(translate("Invalid Pi session tree: missing parent"));
    leaf = parent;
  }
  path.reverse();
  const edits = new Map(
    path
      .filter((entry) => entry.type === "context_edit")
      .map((entry) => [entry.targetId, entry.replacement]),
  );
  const result: NativeTranscript = {
    createdAt: Date.parse(nativeString(header.timestamp)) || file.modifiedAt,
    blocks: [],
    modelSettings: {},
  };
  if (omp) {
    const title = all
      .filter((record) => record.type === "title")
      .map((record) => nativeString(record.title).trim())
      .filter(Boolean)
      .pop();
    if (title) result.title = title;
  }
  const calls = new Map<string, Block>();
  for (const entry of path) {
    const id = `native-${prefix}-${nativeString(entry.id)}`;
    if (entry.type === "model_change")
      result.model =
        omp && typeof entry.model === "string"
          ? `omp:${entry.model}`
          : `${prefix}:${nativeString(entry.provider)}/${nativeString(entry.modelId)}`;
    if (entry.type === "thinking_level_change")
      result.modelSettings.thinking = nativeString(entry.thinkingLevel);
    if (entry.type === "session_info" && typeof entry.name === "string")
      result.title = entry.name;
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      result.blocks.push({
        id,
        role: "system",
        text: nativeString(entry.summary),
      });
      continue;
    }
    if (
      entry.type !== "message" &&
      (entry.type !== "custom_message" || entry.display !== true)
    )
      continue;
    const original =
      entry.type === "message"
        ? nativeRecord(entry.message)
        : { role: "system", content: entry.content };
    const edit = edits.get(entry.id);
    if (edit === null) continue;
    const message =
      edit === undefined
        ? original
        : { ...original, content: nativeRecord(edit).content };
    const text = nativeText(message.content);
    if (
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "system"
    ) {
      if (
        text &&
        (message.role !== "assistant" || !Array.isArray(message.content))
      )
        result.blocks.push({
          id,
          role: message.role,
          text,
          startedAt: Date.parse(nativeString(entry.timestamp)) || undefined,
        });
      if (message.role === "assistant") {
        if (
          typeof message.model === "string" &&
          typeof message.provider === "string"
        )
          result.model = `${prefix}:${message.provider}/${message.model}`;
        if (!Array.isArray(message.content)) continue;
        for (let index = 0; index < message.content.length; index++) {
          const part = nativeRecord(message.content[index]);
          const partText = nativeText([part]);
          if (partText)
            result.blocks.push({
              id: index === 0 ? id : `${id}-text-${index}`,
              role: "assistant",
              text: partText,
              startedAt: Date.parse(nativeString(entry.timestamp)) || undefined,
            });
          if (part.type === "thinking" && typeof part.thinking === "string")
            result.blocks.push({
              id: `${id}-thinking-${index}`,
              role: "reasoning",
              text: part.thinking,
            });
          if (part.type !== "toolCall") continue;
          const callId = nativeString(part.id);
          const block: Block = {
            id: `${id}-tool-${index}`,
            role: "tool",
            text: JSON.stringify(part.arguments ?? {}),
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
    } else if (message.role === "toolResult") {
      const block = calls.get(nativeString(message.toolCallId));
      if (block)
        block.tool = {
          ...block.tool,
          detail: text,
          status: message.isError ? "error" : "completed",
        };
      else if (text)
        result.blocks.push({
          id,
          role: "tool",
          text,
          tool: {
            title: nativeString(message.toolName),
            status: message.isError ? "error" : "completed",
          },
        });
    } else if (message.role === "bashExecution") {
      result.blocks.push({
        id,
        role: "tool",
        text: nativeString(message.command),
        tool: {
          title: nativeString(message.command),
          detail: nativeString(message.output),
          status: message.exitCode ? "error" : "completed",
        },
      });
    }
  }
  return result;
}
