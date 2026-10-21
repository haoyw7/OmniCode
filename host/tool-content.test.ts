import { describe, expect, it, vi } from "vitest";
import { ToolContentService, TOOL_PAGE_BYTES, TOOL_TAIL_BYTES } from "./tool-content";
import type { HostSession, SessionSync } from "../src/features/connections/model/protocol";
import { applySessionSync } from "../src/features/connections/model/protocol";
import type { Block } from "../src/features/sessions/model/session";
import { TOOL_CONTENT_MODE, type ToolContentRef } from "../src/integrations/harness/core/toolContent";

function setup(blocks: Block[]) {
  let value: HostSession = { projectId: "project", revision: 1, status: "idle", updatedAt: 1,
    session: { id: "session", title: "Test", cwd: "/repo", harness: "codex", model: "codex:test", modelSettings: {}, runtimeMode: "supervised", blocks } };
  const service = new ToolContentService({ session: id => { if (id !== "session") throw new Error("Not found"); return value; }, isAssistantSession: id => id === "private" });
  const project = () => {
    const result = service.project({ kind: "snapshot", value });
    if (result.kind !== "snapshot") throw new Error("Expected snapshot");
    return result;
  };
  return { service, project, get: () => value, set: (next: Block[]) => { value = { ...value, revision: value.revision + 1, session: { ...value.session, blocks: next } }; } };
}
const tool = (text: string, id = "tool"): Block => ({ id, role: "tool", text: "Run tests", tool: {
  kind: "Bash", title: "Run tests", status: "completed", input: "npm test", output: text, detail: text, preview: { kind: "shell", title: "npm test", output: text },
} });
function readAll(service: ToolContentService, reference: ToolContentRef, field = "output") {
  let offset = 0, transfer: string | undefined, version = reference.version, output = "";
  for (;;) {
    const page = service.read({ ...reference, field, offset, transfer, version });
    expect(Buffer.byteLength(JSON.stringify({ result: page }))).toBeLessThanOrEqual(TOOL_PAGE_BYTES);
    expect(page.start).toBe(offset);
    expect(page.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    output += page.text; offset = page.end; transfer = page.transfer; version = page.version;
    if (offset === page.total) return output;
  }
}

describe("bounded tool content", () => {
  it("keeps sync size independent of a 1 MiB versus 32 MiB body and never mutates history", () => {
    const measure = (bytes: number) => {
      const original = tool("x".repeat(bytes));
      const s = setup([original]);
      const projection = s.project();
      const block = projection.value.session.blocks[0];
      expect(block.tool?.output).toBeUndefined();
      expect(block.tool?.detail).toBeUndefined();
      expect(block.tool?.preview?.output).toBeUndefined();
      expect(block.toolContent?.fields.find(field => field.name === "detail")?.aliasOf).toBe("output");
      expect(s.get().session.blocks[0]).toBe(original);
      expect(original.tool!.output!.length).toBe(bytes);
      return Buffer.byteLength(JSON.stringify(projection));
    };
    expect(Math.abs(measure(32 * 1024 * 1024) - measure(1024 * 1024))).toBeLessThan(256);
  });

  it("preserves small tools and full pending approvals", () => {
    const small = tool("short", "small"), approval = { ...tool("secret".repeat(10000)), approval: { requestId: 3 } };
    const s = setup([small, approval]);
    expect(s.project().value.session.blocks).toEqual([small, approval]);
    expect(s.project().value.session.blocks[1]).toBe(approval);
  });

  it("round trips escaped Unicode, giant lines and immutable multi-page versions", () => {
    const text = '你好🚀"\\\n\u0001'.repeat(20000);
    const s = setup([tool(text)]), ref = s.project().value.session.blocks[0].toolContent!;
    expect(readAll(s.service, ref)).toBe(text);
    const first = s.service.read({ ...ref, field: "output", offset: 0 });
    s.set([tool("replacement".repeat(2000))]);
    const next = s.service.read({ ...ref, field: "output", transfer: first.transfer, offset: first.end });
    expect(next.version).toBe(first.version);
    expect(next.text).toBe(text.slice(next.start, next.end));
    const latest = s.service.read({ ...ref, field: "output" });
    expect(latest.version).not.toBe(first.version);
    expect(() => s.service.read({ ...ref, field: "output", transfer: first.transfer, version: latest.version })).toThrow("version");
  });

  it("bounds terminal tails to 200 lines and the UTF-8 JSON budget", () => {
    const text = Array.from({ length: 600 }, (_, i) => `line ${i} 你好🚀`).join("\n");
    const s = setup([tool(text)]), ref = s.project().value.session.blocks[0].toolContent!;
    const page = s.service.read({ ...ref, field: "output", tail: true });
    expect(page.text.split("\n")).toHaveLength(200);
    expect(page.text).toBe(text.slice(page.start));
    expect(Buffer.byteLength(JSON.stringify({ result: page }))).toBeLessThanOrEqual(TOOL_TAIL_BYTES);
    const long = setup([tool("🚀".repeat(100000))]);
    const tail = long.service.read({ ...long.project().value.session.blocks[0].toolContent!, field: "output", tail: true });
    expect(Buffer.byteLength(JSON.stringify({ result: tail }))).toBeLessThanOrEqual(TOOL_TAIL_BYTES);
    expect(tail.start % 2).toBe(0);
  });

  it("projects nested and mirrored steps and disambiguates duplicate tool IDs", () => {
    const body = "inner".repeat(10000);
    const parent: Block = { id: "agent", role: "tool", text: "Agent", agentRun: { name: "Worker",
      steps: [{ id: "same", kind: "tool", text: "Bash", detail: body }], transcript: [tool(body + "transcript", "same")] } };
    const s = setup([parent]), projected = s.project().value.session.blocks[0];
    const step = projected.agentRun!.steps[0];
    expect(step.detail).toBeUndefined();
    expect(step.toolContent?.step).toBe(true);
    expect(readAll(s.service, step.toolContent!, "detail")).toBe(body);
    expect(readAll(s.service, projected.agentRun!.transcript![0].toolContent!)).toBe(body + "transcript");
    expect(parent.agentRun!.steps[0].detail).toBe(body);
  });

  it("pages diffs with original row semantics and searches unloaded content", () => {
    const block = tool("prefix".repeat(3000) + "needle");
    block.tool!.preview = { kind: "write", path: "a.ts", additions: 2, deletions: 1,
      lines: [{ kind: "del", number: 3, text: "before" }, { kind: "add", number: 3, text: "after".repeat(20000) }] };
    const s = setup([block]), ref = s.project().value.session.blocks[0].toolContent!;
    const page = s.service.read({ ...ref, field: "diff" });
    expect(page.lines?.[0]).toEqual({ kind: "del", number: 3, text: "before" });
    expect(readAll(s.service, ref, "diff")).toBe("-before\n+" + "after".repeat(20000) + "\n");
    expect(s.service.search({ sessionId: "session", query: "needle" })).toMatchObject({ ids: ["tool"], total: 1, hits: { tool: { field: "output", offset: 18000 } } });
  });

  it("rejects cross-session reads, invalid ranges and expired transfers", () => {
    const s = setup([tool("🚀".repeat(10000))]), ref = s.project().value.session.blocks[0].toolContent!;
    expect(() => s.service.read({ ...ref, sessionId: "private", field: "output" })).toThrow("private");
    expect(() => s.service.read({ ...ref, blockPath: ["missing"], field: "output" })).toThrow("no longer exists");
    expect(() => s.service.read({ ...ref, field: "output", offset: 1 })).toThrow("offset");
    expect(() => s.service.read({ ...ref, field: "__proto__" })).toThrow("field");
    const page = s.service.read({ ...ref, field: "output" });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121000);
    try { expect(() => s.service.read({ ...ref, field: "output", transfer: page.transfer })).toThrow("expired"); }
    finally { vi.restoreAllMocks(); }
  });

  it("requires a snapshot when the content mode changes and preserves projected deltas", () => {
    const s = setup([tool("x".repeat(20000))]), known = s.get(), projected = s.project();
    expect(() => applySessionSync(known, { kind: "unchanged", revision: 1, contentMode: TOOL_CONTENT_MODE })).toThrow("base");
    const base = applySessionSync(undefined, projected);
    expect(applySessionSync(base, { kind: "unchanged", revision: 1, contentMode: TOOL_CONTENT_MODE })).toBe(base);
    s.set([tool("next".repeat(20000))]);
    const { session: { blocks, ...session }, ...metadata } = s.get();
    const delta: SessionSync = { kind: "delta", base: 1, value: { ...metadata, session }, blockIds: ["tool"], blocks };
    const next = applySessionSync(base, s.service.project(delta));
    expect(next.session.blocks[0].toolContent?.version).not.toBe(base.session.blocks[0].toolContent?.version);
    expect(next.session.blocks[0].tool?.output).toBeUndefined();
  });
});
