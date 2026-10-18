import {
  isAgentTool,
  isEditTool,
  isExecuteTool,
  isReadTool,
  isSearchTool,
  isSkillTool,
} from "../../../integrations/harness/core/preview";
import { monoCodeToolCall } from "./monocodeToolCall";
import type { Block } from "./session";
import { toolCallLabel, toolCallState } from "./transcriptActivity";

/**
 * Which row draws a tool call. Every row shares one layout; the kind only
 * decides the summary line and what opens under it.
 */
export type ToolRendererKind =
  | "monocode"
  | "agent"
  | "question"
  | "skill"
  | "edit"
  | "read"
  | "search"
  | "execute"
  | "mcp"
  | "generic";

const QUESTION_TOOL =
  /^(?:askuserquestion|ask_?user_?question|ask_?question|request_?user_?input)$/i;

/** Order matters: the more specific claim wins, as in `toolCategory`. */
export function resolveToolRenderer(block: Block): ToolRendererKind {
  const tool = block.tool;
  const kind = tool?.kind;
  const title = block.text || tool?.title;
  const preview = tool?.preview;
  if (monoCodeToolCall(block)) return "monocode";
  if (isAgentTool(kind, title)) return "agent";
  if (isQuestionTool(kind, tool?.title ?? block.text)) return "question";
  if (isSkillTool(kind, title) || /^Skill\b/.test(toolCallLabel(block)))
    return "skill";
  if (isEditTool(kind, title, preview)) return "edit";
  if (isSearchTool(kind, title, preview)) return "search";
  if (isReadTool(kind, title, preview)) return "read";
  if (preview?.kind === "shell" || isExecuteTool(kind, title)) return "execute";
  if (isMcpTool(kind, title)) return "mcp";
  return "generic";
}

function isQuestionTool(kind?: string, title?: string): boolean {
  return [kind, title].some((value) => QUESTION_TOOL.test(value?.trim() ?? ""));
}

function isMcpTool(kind?: string, title?: string): boolean {
  return [kind, title].some((value) =>
    /^mcp(?:__|:|$)/i.test(value?.trim() ?? ""),
  );
}

const FILE_RENDERERS = new Set<ToolRendererKind>(["edit", "read", "search"]);

/** What a tool call opens onto: its output, or its result once it is back. */
export function toolBodyText(
  block: Block,
  renderer: ToolRendererKind,
): string | undefined {
  const tool = block.tool;
  const output =
    renderer === "execute" ? tool?.preview?.output?.trim() : undefined;
  if (output) return output;
  const state = toolCallState(block);
  // While running, detail is only the request echoed back; the result replaces it.
  if (state === "pending") return undefined;
  // File rows already show what they touched; only a failure has more to say.
  if (FILE_RENDERERS.has(renderer) && state !== "rejected") return undefined;
  const detail = tool?.detail?.trim();
  // A request summary that only repeats the row's own label adds nothing.
  if (!detail || detail === toolCallLabel(block).trim()) return undefined;
  return detail;
}
