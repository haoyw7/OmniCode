import { createHash, randomUUID } from "node:crypto";
import {
  TOOL_CONTENT_FIELDS, TOOL_CONTENT_MODE, type ToolContentField, type ToolContentPage,
  type ToolContentRef, type ToolContentSearchPage,
} from "../src/integrations/harness/core/toolContent";

// The service port describes only the stored fields it reads. Projection preserves
// every other session/block property; it does not import frontend models.
type ToolPreviewLine = NonNullable<ToolContentPage["lines"]>[number];
type Preview = { kind: string; title?: string; path?: string; query?: string; output?: string;
  lines?: ToolPreviewLine[]; additions?: number; deletions?: number };
type AgentStep = { id: string; kind: string; text: string; toolKind?: string; status?: string;
  detail?: string; preview?: Preview; toolContent?: ToolContentRef };
type Block = { id: string; role: string; text: string; streaming?: boolean; toolContent?: ToolContentRef;
  image?: { name?: string; alt?: string };
  tool?: { background?: boolean; title?: string; kind?: string; status?: string; input?: string; output?: string; detail?: string; preview?: Preview };
  approval?: { decided?: string };
  agentRun?: { steps: AgentStep[]; transcript?: Block[] } };
export type ToolContentSnapshot = { revision: number; session: { id: string; blocks: Block[] } };
type SessionSync = { kind: "unchanged" } | { kind: "snapshot"; value: ToolContentSnapshot }
  | { kind: "delta"; value: { session: { id: string } }; blocks: Block[] };
type ContentStore = { session(id: string): ToolContentSnapshot; isAssistantSession(id: string): boolean };

function agentStepBlock(step: AgentStep): Block {
  return { id: step.id, role: step.kind === "tool" ? "tool" : step.kind, text: step.text,
    ...(step.kind === "tool" ? { tool: { title: step.text, kind: step.toolKind, status: step.status,
      detail: step.detail, preview: step.preview } } : {}) };
}
function resolveAgentBlock(blocks: Block[], path: readonly string[], stepBlock: (step: AgentStep) => Block): Block | undefined {
  let current: Block | undefined;
  for (const id of path) {
    current = blocks.find(block => block.id === id);
    if (!current) return undefined;
    blocks = current.agentRun?.transcript ?? current.agentRun?.steps.map(stepBlock) ?? [];
  }
  return current;
}
function isRunning(block: Block): boolean {
  const status = block.tool?.status?.toLowerCase();
  const decision = block.approval?.decided;
  if (decision === "deny" || ["failed", "error", "cancelled", "canceled"].includes(status ?? "")) return false;
  if (block.approval && !decision) return true;
  if (status === "completed" || status === "success") return false;
  if (block.streaming || ["running", "pending", "in_progress"].includes(status ?? "")) return true;
  return !!status && decision !== "allow" && decision !== "cancelled";
}

export const INLINE_TOOL_BYTES = 8 * 1024;
export const TOOL_PAGE_BYTES = 256 * 1024;
export const TOOL_TAIL_BYTES = 64 * 1024;
const TTL = 120_000;
const MAX_TRANSFERS = 8;
type Content = {
  version: string;
  fields: Partial<Record<ToolContentField, string>>;
  manifest: ToolContentRef["fields"];
  diff?: { start: number; end: number; line: ToolPreviewLine }[];
};
type Transfer = { sessionId: string; path: string; content: Content; expires: number };

function boundary(text: string, offset: number): number {
  const code = text.charCodeAt(offset);
  return offset > 0 && code >= 0xdc00 && code <= 0xdfff &&
    text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff ? offset - 1 : offset;
}

/** Views and bounded reads only. Never saves projected blocks back to the store. */
export class ToolContentService {
  private contents = new WeakMap<Block, Content>();
  private steps = new WeakMap<AgentStep, Block>();
  private stepBlock = (step: AgentStep): Block => {
    let block = this.steps.get(step);
    if (!block) { block = agentStepBlock(step); this.steps.set(step, block); }
    return block;
  };
  private transfers = new Map<string, Transfer>();
  constructor(private readonly store: ContentStore) {}

  forget(sessionId: string) {
    for (const [key, value] of this.transfers) if (value.sessionId === sessionId) this.transfers.delete(key);
  }

  private session(id: unknown) {
    if (typeof id !== "string" || !id) throw new Error("Invalid session ID");
    if (this.store.isAssistantSession(id)) throw new Error("Assistant brain is private");
    return this.store.session(id);
  }

  private content(block: Block): Content {
    const cached = this.contents.get(block);
    if (cached) return cached;
    const tool = block.tool;
    const fields: Content["fields"] = {};
    const add = (name: ToolContentField, value: string | undefined) => { if (value !== undefined) fields[name] = value; };
    add("output", tool?.output); add("input", tool?.input); add("detail", tool?.detail);
    add("previewOutput", tool?.preview?.output);
    if (block.text.length > 2048) add("text", block.text);
    if ((tool?.title?.length ?? 0) > 2048) add("title", tool!.title);
    if ((tool?.preview?.title?.length ?? 0) > 2048) add("previewTitle", tool!.preview!.title);
    if ((tool?.preview?.query?.length ?? 0) > 2048) add("query", tool!.preview!.query);
    let diff: Content["diff"];
    if (tool?.preview?.lines) {
      let offset = 0;
      const pieces: string[] = [];
      diff = tool.preview.lines.map(line => {
        const start = offset + 1;
        const text = `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}\n`;
        pieces.push(text); offset += text.length;
        return { start, end: start + line.text.length, line };
      });
      add("diff", pieces.join(""));
    }
    const hash = createHash("sha256");
    const seen = new Map<string, ToolContentField>();
    const manifest = Object.entries(fields).map(([key, text]) => {
      const name = key as ToolContentField;
      hash.update(`${name}:${text.length}:`).update(text);
      if (name === "diff") hash.update(JSON.stringify(tool?.preview?.lines));
      const aliasOf = seen.get(text);
      seen.set(text, aliasOf ?? name);
      return { name, characters: text.length, bytes: Buffer.byteLength(JSON.stringify(name === "diff" ? tool?.preview?.lines : text)), ...(aliasOf ? { aliasOf } : {}) };
    });
    const value = { version: hash.digest("hex"), fields, manifest, diff };
    this.contents.set(block, value);
    return value;
  }

  private projectBlock(block: Block, sessionId: string, path: string[]): Block {
    let next = block;
    // Approval views must retain the complete command/change the user is approving.
    if ((block.tool || block.role === "tool") && !(block.approval && !block.approval.decided)) {
      const content = this.content(block);
      if (content.manifest.reduce((sum, field) => sum + field.bytes, 0) > INLINE_TOOL_BYTES) {
        const preview = block.tool?.preview ? { ...block.tool.preview } : undefined;
        const tool = block.tool ? { ...block.tool, preview } : undefined;
        if (preview?.lines) {
          preview.additions ??= preview.lines.filter(line => line.kind === "add").length;
          preview.deletions ??= preview.lines.filter(line => line.kind === "del").length;
        }
        next = { ...block, tool, toolContent: { sessionId, blockPath: path, version: content.version, fields: content.manifest } };
        for (const field of content.manifest) {
          if (field.name === "text") next.text = `${block.text.slice(0, boundary(block.text, 512))}…`;
          else if (tool && field.name === "title") tool.title = `${tool.title!.slice(0, boundary(tool.title!, 512))}…`;
          else if (preview && field.name === "previewTitle") preview.title = `${preview.title!.slice(0, boundary(preview.title!, 512))}…`;
          else if (preview && field.name === "query") preview.query = `${preview.query!.slice(0, boundary(preview.query!, 512))}…`;
          else if (preview && field.name === "previewOutput") delete preview.output;
          else if (preview && field.name === "diff") delete preview.lines;
          else if (tool && (field.name === "input" || field.name === "output" || field.name === "detail")) delete tool[field.name];
        }
      }
    }
    if (block.agentRun) {
      const run = block.agentRun;
      // Mirrored steps can duplicate the same huge output. Project both representations.
      const steps = run.steps.map(step => {
        const projected = this.projectBlock(this.stepBlock(step), sessionId, [...path, step.id]);
        return projected.toolContent ? { ...step, text: projected.text, detail: projected.tool?.detail,
          preview: projected.tool?.preview, toolContent: { ...projected.toolContent, step: true } } satisfies AgentStep : step;
      });
      next = { ...next, agentRun: { ...run, steps,
        ...(run.transcript ? { transcript: run.transcript.map(child => this.projectBlock(child, sessionId, [...path, child.id])) } : {}) } };
    }
    return next;
  }

  project<T extends SessionSync>(sync: T): T {
    if (sync.kind === "unchanged") return { ...sync, contentMode: TOOL_CONTENT_MODE };
    const sessionId = sync.value.session.id;
    if (sync.kind === "snapshot") return { ...sync, contentMode: TOOL_CONTENT_MODE,
      value: { ...sync.value, contentMode: TOOL_CONTENT_MODE,
        session: { ...sync.value.session, blocks: sync.value.session.blocks.map(b => this.projectBlock(b, sessionId, [b.id])) } } };
    return { ...sync, contentMode: TOOL_CONTENT_MODE, value: { ...sync.value, contentMode: TOOL_CONTENT_MODE },
      blocks: sync.blocks.map(b => this.projectBlock(b, sessionId, [b.id])) };
  }

  read(params: Record<string, unknown>): ToolContentPage {
    const session = this.session(params.sessionId);
    const path = params.blockPath;
    if (!Array.isArray(path) || !path.length || path.length > 64 || path.some(id => typeof id !== "string" || !id || id.length > 1024))
      throw new Error("Invalid tool content path");
    if (!TOOL_CONTENT_FIELDS.includes(params.field as ToolContentField)) throw new Error("Invalid tool content field");
    const field = params.field as ToolContentField, identity = JSON.stringify([path, params.step === true]);
    const now = Date.now();
    for (const [key, entry] of this.transfers) if (entry.expires < now) this.transfers.delete(key);
    const step = params.step === true
      ? resolveAgentBlock(session.session.blocks, path.slice(0, -1), this.stepBlock)?.agentRun?.steps.find(row => row.id === path.at(-1)) : undefined;
    const block = params.step === true ? (step ? this.stepBlock(step) : undefined) : resolveAgentBlock(session.session.blocks, path, this.stepBlock);
    let transfer = typeof params.transfer === "string" ? params.transfer : undefined;
    let entry = transfer ? this.transfers.get(transfer) : undefined;
    if (transfer && (!entry || entry.sessionId !== session.session.id || entry.path !== identity))
      throw new Error("Tool content expired. Reload the details.");
    if (!entry) {
      if (!block || !(block.tool || block.role === "tool")) throw new Error("Tool content no longer exists");
      const content = this.content(block);
      // Initial reads take a coherent current snapshot, even if the summary was just superseded.
      entry = { sessionId: session.session.id, path: identity, content, expires: now + TTL };
      const existing = [...this.transfers].find(([, old]) => old.sessionId === entry!.sessionId && old.path === identity && old.content.version === content.version);
      if (existing) { transfer = existing[0]; entry = existing[1]; }
      else {
        while (this.transfers.size >= MAX_TRANSFERS) this.transfers.delete(this.transfers.keys().next().value!);
        transfer = randomUUID(); this.transfers.set(transfer, entry);
      }
    }
    if (params.transfer && params.version !== undefined && params.version !== entry.content.version)
      throw new Error("Tool content version does not match");
    entry.expires = now + TTL;
    this.transfers.delete(transfer!); this.transfers.set(transfer!, entry);
    const text = entry.content.fields[field];
    if (text === undefined) throw new Error("Tool content field no longer exists");
    const total = text.length;
    for (const key of ["offset", "end"] as const) if (params[key] !== undefined &&
      (!Number.isSafeInteger(params[key]) || Number(params[key]) < 0 || Number(params[key]) > total || boundary(text, Number(params[key])) !== params[key]))
      throw new Error("Invalid tool content offset");
    const tail = params.tail === true && params.offset === undefined;
    const endLimit = params.end === undefined ? total : Number(params.end);
    let start = params.offset === undefined ? 0 : Number(params.offset);
    let end = boundary(text, Math.min(endLimit, start + 48 * 1024));
    if (start > endLimit) throw new Error("Invalid tool content range");
    if (tail) {
      end = endLimit; start = boundary(text, Math.max(0, end - 48 * 1024));
      let lineStart = end, lines = 0;
      while (lineStart > start && lines < 200) { const index = text.lastIndexOf("\n", lineStart - 2); lineStart = index < 0 ? 0 : index + 1; lines++; }
      start = Math.max(start, lineStart);
    }
    const page = (): ToolContentPage => ({ sessionId: entry!.sessionId, blockPath: path as string[], field,
      version: entry!.content.version, transfer: transfer!, running: !!block && isRunning(block), start, end, total, text: text.slice(start, end),
      ...(field === "diff" ? { lines: entry!.content.diff!.filter(row => row.end >= start && row.start < end)
        .map(row => ({ ...row.line, text: text.slice(Math.max(start, row.start), Math.min(end, row.end)) })) } : {}) });
    let result = page();
    const budget = (tail ? TOOL_TAIL_BYTES : TOOL_PAGE_BYTES) - 1024;
    while (Buffer.byteLength(JSON.stringify(result)) > budget && end - start > 2) {
      if (tail) start = boundary(text, start + Math.ceil((end - start) / 2));
      else end = boundary(text, start + Math.floor((end - start) / 2));
      result = page();
    }
    if (Buffer.byteLength(JSON.stringify(result)) > budget) throw new Error("Tool content metadata exceeds the response budget");
    return result;
  }

  search(params: Record<string, unknown>): ToolContentSearchPage {
    const value = this.session(params.sessionId);
    if (typeof params.query !== "string" || params.query.length > 4096) throw new Error("Invalid search query");
    const offset = params.offset ?? 0;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0) throw new Error("Invalid search offset");
    // Preserve the existing conversation find semantics, including unloaded tool output.
    const needle = params.query.trim().toLowerCase();
    const ids = needle ? value.session.blocks.filter(block =>
      ["user", "assistant", "tool", "tasks", "plan", "image"].includes(block.role) &&
      [block.text, block.image?.name, block.image?.alt, block.tool?.title, block.tool?.preview?.path, block.tool?.preview?.query, block.tool?.preview?.title,
        ...Object.values(this.content(block).fields)].some(text => text?.toLowerCase().includes(needle))
    ).map(block => block.id) : [];
    const end = Math.min(ids.length, Number(offset) + 100);
    const hits: NonNullable<ToolContentSearchPage["hits"]> = Object.create(null);
    for (const id of ids.slice(Number(offset), end)) {
      const block = value.session.blocks.find(row => row.id === id)!;
      if (!block.tool && block.role !== "tool") continue;
      const content = this.content(block);
      for (const [key, text] of Object.entries(content.fields)) {
        const found = text.toLowerCase().indexOf(needle);
        if (needle && found >= 0) { hits[id] = { field: key as ToolContentField, offset: boundary(text, found) }; break; }
      }
    }
    return { revision: value.revision, ids: ids.slice(Number(offset), end), hits, total: ids.length,
      ...(end < ids.length ? { next: end } : {}) };
  }
}
