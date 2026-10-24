import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { TextPromptInput } from "../src/integrations/harness/core/registry";
import type { HostProvider } from "./providers";
import { HostEngine, parseCommand } from "./engine";
import { HostStore } from "./store";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-submission-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Project");
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const sideTurns: { input: TextPromptInput; resolve: (text: string) => void; reject: (error: Error) => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn(input => new Promise<void>(finish => { turns.push({ input, finish }); })),
    stop: vi.fn(async () => { turns.at(-1)?.finish(); }),
    cancel: vi.fn(async () => { turns.at(-1)?.finish(); }),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(), steer: vi.fn(async () => undefined),
    rewindLastTurn: vi.fn(async () => ({ submitted: false })),
  };
  const runText = vi.fn((input: TextPromptInput & { harness: string }) => new Promise<string>((resolve, reject) => {
    sideTurns.push({ input, resolve, reject });
    input.signal?.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true });
  }));
  const makeEngine = () => new HostEngine(store, { codex: provider, claude: provider }, undefined, {
    runText, native: { environment: { home: join(directory, "home"), env: {} } },
  });
  let engine = makeEngine();
  await Promise.all([engine.ready, engine.workflows.ready]);
  const receipt = engine.command({ type: "create", commandId: "create", projectId: project.id,
    harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  cleanups.push(async () => { await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const id = receipt.sessionId;
  const current = () => store.session(id).session;
  async function finish(index = turns.length - 1, output = "Answer") {
    turns[index].input.onEvent({ type: "message.delta", text: output });
    turns[index].finish();
    await vi.waitFor(() => expect(current().blocks.find(block => block.id === `send-${index}`)?.turnOutcome ?? store.session(id).status).not.toBe("running"));
  }
  return { get engine() { return engine; }, store, provider, turns, sideTurns, runText, id, current, finish,
    restart: async () => { await engine.close(); engine = makeEngine(); await engine.ready; },
  };
}

it("replays a create receipt across restart without a second session and rejects changed create payloads", async () => {
  const f = await fixture();
  const projectId = f.store.session(f.id).projectId;
  const create = { type: "create", commandId: "create", projectId, harness: "codex", model: "codex:test", runtimeMode: "supervised" };
  const count = () => f.store.sessions().length;
  const before = count();
  expect(f.engine.command(create).sessionId).toBe(f.id);
  await f.restart();
  expect(f.engine.command(create).sessionId).toBe(f.id);
  expect(count()).toBe(before);
  expect(() => f.engine.command({ ...create, model: "codex:other" })).toThrow(/different payload/);
  expect(count()).toBe(before);
});

it("persists submission context through queue dispatch and exposes a durable completion", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "first", sessionId: f.id, text: "First" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  const command = { type: "send", commandId: "queued", sessionId: f.id, text: "Fix it", ciContext: "CI evidence", promptOverride: "Repair with evidence",
    appRequestId: "request_1", noteCard: { id: "note", slug: "note", title: "Note", body: "Note body" } };
  const accepted = f.engine.command(command);
  expect(f.engine.command(command)).toEqual(accepted);
  expect(() => f.engine.command({ ...command, ciContext: "Different evidence" })).toThrow(/different/i);
  expect(f.current().queuedMessages?.[0].appRequestId).toBe("request_1");
  expect(f.engine.commandOutcome(f.id, "queued")).not.toHaveProperty("outcome");
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  expect(f.turns[1].input.text).toBe("Repair with evidence");
  f.turns[1].input.onEvent({ type: "message.delta", text: "Fixed" });
  f.turns[1].finish();
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "queued")?.turnOutcome?.status).toBe("completed"));
  expect(f.current().blocks.find(block => block.id === "queued")).toMatchObject({ text: "Fix it", ciContext: "CI evidence", appRequestId: "request_1", turnOutcome: { text: "Fixed" } });
  expect(f.engine.command(command)).toEqual(accepted);
  expect(f.provider.send).toHaveBeenCalledTimes(2);
  expect(f.engine.commandOutcome(f.id, "queued")).toMatchObject({ sessionId: f.id, commandId: "queued", outcome: { status: "completed", text: "Fixed" } });
  expect(f.engine.commandOutcome(f.id, "queued")).not.toHaveProperty("blocks");
  expect(() => f.engine.commandOutcome(f.id, "missing")).toThrow("Submission not found");
});

it("steers note and handoff context while retaining only the user's text and card metadata", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "first", sessionId: f.id, text: "First" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.engine.command({ type: "send", commandId: "steer", sessionId: f.id, text: "Use it", followUpBehavior: "steer",
    noteCard: { id: "note", slug: "note", title: "Note", body: "Private note body" },
    handoffCard: { from: "claude", to: "codex", brief: "Prior handoff brief" } });
  await vi.waitFor(() => expect(f.provider.steer).toHaveBeenCalledOnce());
  expect(vi.mocked(f.provider.steer!).mock.calls[0][0].text).toContain("Private note body");
  expect(vi.mocked(f.provider.steer!).mock.calls[0][0].text).toContain("Prior handoff brief");
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "steer")).toMatchObject({ text: "Use it", secondOpinion: { kind: "handoff" }, noteCard: { id: "note" } }));
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "steer")?.turnOutcome?.status).toBe("completed"));
});

it("accepts a note-only submission and keeps note contents out of its display card", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "note-only", sessionId: f.id, text: "",
    noteCard: { id: "note", slug: "note", title: "Saved note", body: "Note contents" } });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  expect(f.turns[0].input.text).toContain("Use this note.");
  expect(f.turns[0].input.text).toContain("Note contents");
  expect(f.current().blocks[0].noteCard).toEqual({ id: "note", slug: "note", title: "Saved note" });
});

it("runs BTW in Host and synchronizes streamed blocks, receipts, stop and retry", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "first", sessionId: f.id, text: "Main question" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onEvent({ type: "message.delta", text: "Main answer" });
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
  const sourceEndBlockId = f.current().blocks.at(-1)!.id;
  const command = { type: "btw", action: "send", commandId: "btw-first", sessionId: f.id,
    userBlockId: "first", threadId: "side", sourceEndBlockId, messageId: "side-user", text: "Why?" };
  const receipt = f.engine.command(command);
  expect(f.engine.command(command)).toEqual(receipt);
  expect(() => f.engine.command({ ...command, text: "Different" })).toThrow(/different/i);
  await vi.waitFor(() => expect(f.sideTurns).toHaveLength(1));
  expect(f.sideTurns[0].input.prompt).toContain("Main answer");
  expect(f.sideTurns[0].input.prompt).toContain("Why?");
  f.sideTurns[0].input.onEvent!({ type: "message.delta", text: "Because" });
  await vi.waitFor(() => expect(f.current().blocks[0].btwThreads?.[0].pendingBlocks?.[0].text).toBe("Because"));
  f.sideTurns[0].resolve("Because");
  await vi.waitFor(() => expect(f.current().blocks[0].btwThreads?.[0].status).toBe("ready"));
  expect(f.current().blocks[0].btwThreads?.[0].messages.at(-1)).toMatchObject({ role: "assistant", text: "Because", blocks: [{ text: "Because", streaming: false }] });
  expect(f.provider.send).toHaveBeenCalledOnce();
  const second = { ...command, commandId: "btw-second", messageId: "side-user-2", text: "Explain more" };
  f.engine.command(second);
  await vi.waitFor(() => expect(f.sideTurns).toHaveLength(2));
  f.engine.command({ ...command, action: "stop", commandId: "stop" });
  expect(f.sideTurns[1].input.signal?.aborted).toBe(true);
  expect(f.current().blocks[0].btwThreads?.[0].status).toBe("ready");
  f.engine.command({ ...command, action: "retry", commandId: "retry" });
  await vi.waitFor(() => expect(f.sideTurns).toHaveLength(3));
  f.sideTurns[2].resolve("More");
  await vi.waitFor(() => expect(f.current().blocks[0].btwThreads?.[0].messages.at(-1)?.text).toBe("More"));
});

it("rejects BTW against unfinished turns and malformed submission metadata", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "first", sessionId: f.id, text: "Main" });
  expect(() => f.engine.command({ type: "btw", action: "send", commandId: "btw", sessionId: f.id,
    userBlockId: "first", sourceEndBlockId: "first", threadId: "side", messageId: "message", text: "Why?" })).toThrow(/completed/);
  expect(() => parseCommand({ type: "send", commandId: "x", sessionId: f.id, text: "x", appRequestId: "bad id" })).toThrow(/request ID/);
  expect(() => parseCommand({ type: "send", commandId: "x", sessionId: f.id, text: "x", buildTarget: { harness: "bogus", model: "x" } })).toThrow(/build target/);
});

it("retains the original turn until provider rewind succeeds and never replays a replacement", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "original", sessionId: f.id, text: "Original" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onEvent({ type: "turn.started", providerTurnId: "turn-original" });
  f.turns[0].input.onEvent({ type: "message.delta", text: "Original answer" });
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
  let rewind!: () => void;
  vi.mocked(f.provider.rewindLastTurn!).mockImplementationOnce(() => new Promise(resolve => { rewind = () => resolve({ submitted: false }); }));
  const command = { type: "send", commandId: "edited", sessionId: f.id, text: "Edited", resendEdited: true };
  const receipt = f.engine.command(command);
  await vi.waitFor(() => expect(f.provider.rewindLastTurn).toHaveBeenCalledOnce());
  expect(f.current().blocks.some(block => block.id === "original")).toBe(true);
  expect(f.engine.command(command)).toEqual(receipt);
  rewind();
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  expect(f.current().blocks.some(block => block.id === "original")).toBe(false);
  expect(f.turns[1].input.text).toBe("Edited");
  expect(vi.mocked(f.provider.rewindLastTurn!).mock.calls[0][0].providerTurnId).toBe("turn-original");
  f.turns[1].finish();
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "edited")?.turnOutcome?.status).toBe("completed"));
  expect(f.engine.command(command)).toEqual(receipt);
  expect(f.provider.rewindLastTurn).toHaveBeenCalledOnce();
});

it("keeps prior transcript and reports durable failure when provider rejects edited resend", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "original", sessionId: f.id, text: "Original" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onEvent({ type: "turn.started", providerTurnId: "turn-original" });
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
  vi.mocked(f.provider.rewindLastTurn!).mockRejectedValueOnce(new Error("Provider cannot rewind"));
  f.engine.command({ type: "send", commandId: "edited", sessionId: f.id, text: "Edited", resendEdited: true });
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "edited")?.turnOutcome).toMatchObject({ status: "failed", error: "Provider cannot rewind", providerRewound: false }));
  expect(f.current().blocks.some(block => block.id === "original")).toBe(true);
  expect(f.provider.send).toHaveBeenCalledOnce();
});

it("builds an approved plan with an atomic model/provider target", async () => {
  const f = await fixture();
  const value = f.store.session(f.id);
  f.store.save({ ...value, revision: value.revision + 1, session: { ...value.session, blocks: [
    { id: "user", role: "user", text: "Plan this", durationMs: 100 },
    { id: "plan", role: "plan", text: "1. Change code\n2. Check it", plan: { status: "ready" } },
  ] } }, { type: "test.plan" });
  f.engine.command({ type: "send", commandId: "build", sessionId: f.id, text: "Build approved plan", intent: "build", planBlockId: "plan",
    buildTarget: { harness: "claude", model: "claude:test", modelSettings: { effort: "high" } } });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  expect(f.current()).toMatchObject({ harness: "claude", model: "claude:test" });
  expect(f.turns[0].input).toMatchObject({ intent: "build", model: "claude:test", modelSettings: { effort: "high" } });
  expect(f.current().blocks.find(block => block.id === "plan")?.plan?.status).toBe("building");
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.current().blocks.find(block => block.id === "plan")?.plan?.status).toBe("built"));
});

it("returns accepted approve and answer receipts after resolution and rejects changed payloads", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "first", sessionId: f.id, text: "Work" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onEvent({ type: "approval.requested", requestId: 1, title: "Allow?" });
  const approval = { type: "approve", commandId: "approval", sessionId: f.id, runId: f.store.session(f.id).runId, requestId: 1, decision: "allow" };
  const receipt = f.engine.command(approval);
  expect(f.engine.command(approval)).toEqual(receipt);
  expect(() => f.engine.command({ ...approval, decision: "deny" })).toThrow(/different payload/);
  expect(f.provider.approve).toHaveBeenCalledOnce();
  f.turns[0].input.onEvent({ type: "question.asked", requestId: 2, questions: [{ id: "q", prompt: "Choose", multiSelect: false, options: [{ label: "One" }] }] });
  const answer = { type: "answer", commandId: "answer", sessionId: f.id, runId: f.store.session(f.id).runId, requestId: 2, reply: { kind: "answered", answers: { q: ["One"] } } };
  const answered = f.engine.command(answer);
  expect(f.engine.command(answer)).toEqual(answered);
  expect(() => f.engine.command({ ...answer, reply: { kind: "skipped" } })).toThrow(/different payload/);
  expect(f.provider.answer).toHaveBeenCalledOnce();
});

it("edits plan text durably and refuses edits once the approved build starts", async () => {
  const f = await fixture(); const value = f.store.session(f.id);
  f.store.save({ ...value, revision: value.revision + 1, session: { ...value.session,
    blocks: [{ id: "plan", role: "plan", text: "Original", plan: { status: "ready" } }] } }, { type: "test.plan" });
  const command = { type: "editPlan", sessionId: f.id, commandId: "edit-plan", blockId: "plan", text: "Edited" };
  const receipt = f.engine.command(command);
  expect(f.engine.command(command)).toEqual(receipt);
  expect(f.current().blocks[0]).toMatchObject({ text: "Edited", plan: { originalText: "Original", edited: true, status: "ready" } });
  f.engine.command({ type: "send", commandId: "build", sessionId: f.id, text: "Build approved plan", intent: "build", planBlockId: "plan" });
  expect(() => f.engine.command({ ...command, commandId: "late", text: "Too late" })).toThrow(/cannot be edited/);
});

it("resumes a limited conversation in Host before its paused queue and deduplicates the resume command", async () => {
  const f = await fixture();
  f.engine.command({ type: "send", commandId: "limited", sessionId: f.id, text: "First" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.engine.command({ type: "send", commandId: "queued", sessionId: f.id, text: "Then this" });
  f.turns[0].input.onEvent({ type: "usage.limited", resetsAt: Date.now() + 60_000 });
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
  f.engine.command({ type: "usageLimit", action: "resumeAtReset", commandId: "arm", sessionId: f.id, enabled: true });
  expect(f.current().usageLimit?.resumeAtReset).toBe(true);
  const command = { type: "usageLimit", action: "resume", commandId: "resume-limit", sessionId: f.id };
  const receipt = f.engine.command(command);
  expect(f.engine.command(command)).toEqual(receipt);
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  expect(f.turns[1].input.text).toBe("Continue from where you left off.");
  expect(f.current().usageLimit).toBeUndefined();
  f.turns[1].finish();
  await vi.waitFor(() => expect(f.turns).toHaveLength(3));
  expect(f.turns[2].input.text).toBe("Then this");
});

it("restores an armed usage-limit continuation after Host restart without any client", async () => {
  const f = await fixture();
  const value = f.store.session(f.id);
  const resetsAt = Date.now() - 31_000;
  f.store.save({ ...value, revision: value.revision + 1, session: { ...value.session,
    usageLimit: { resetsAt, resumeAtReset: true },
  } }, { type: "test.savedLimit" });
  await f.restart();
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  expect(f.turns[0].input.text).toBe("Continue from where you left off.");
  expect(f.current().usageLimit).toBeUndefined();
  f.turns[0].finish();
  await vi.waitFor(() => expect(f.store.session(f.id).status).toBe("idle"));
  await f.restart();
  expect(f.provider.send).toHaveBeenCalledOnce();
});
