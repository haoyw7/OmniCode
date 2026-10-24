import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { InboxAskContext } from "../src/contracts/inbox";
import type { HostProvider } from "./providers";
import { HostEngine, parseCommand } from "./engine";
import { HostStore, summary } from "./store";
import { inboxPrompt } from "./inbox";

const source: InboxAskContext = {
  key: "github:github.com:/acme/app/pull/42", title: "Fix login",
  url: "https://github.com/acme/app/pull/42", provider: "github", description: "Source body",
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-inbox-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Inbox");
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((finish) => { turns.push({ input, finish }); })),
    stop: vi.fn(async () => { turns.at(-1)?.finish(); }),
    cancel: vi.fn(async () => { turns.at(-1)?.finish(); }),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(), steer: vi.fn(async () => undefined),
  };
  const makeEngine = () => new HostEngine(store, { codex: provider, claude: provider }, undefined, {
    native: { environment: { home: join(directory, "home"), env: {} } },
  });
  let engine = makeEngine();
  await Promise.all([engine.ready, engine.workflows.ready]);
  const command = { type: "create", commandId: "create-inbox", projectId: project.id,
    harness: "codex", model: "codex:test", runtimeMode: "supervised", inboxAsk: source };
  const receipt = engine.command(command);
  cleanups.push(async () => {
    await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { store, provider, turns, command, receipt, id: receipt.sessionId,
    get engine() { return engine; },
    async restart() { await engine.close(); engine = makeEngine(); await Promise.all([engine.ready, engine.workflows.ready]); },
  };
}

it("persists inbox source once, rejects conflicting replays, and omits its body from summaries", async () => {
  const fixture = await setup();
  expect(fixture.engine.command(fixture.command)).toEqual(fixture.receipt);
  expect(fixture.store.summaries()).toHaveLength(1);
  expect(fixture.store.session(fixture.id).session.inboxAsk).toEqual(source);
  expect(() => fixture.engine.command({ ...fixture.command, inboxAsk: { ...source, description: "Changed" } })).toThrow();
  expect(summary(fixture.store.session(fixture.id)).inboxAsk).toEqual({
    key: source.key, title: source.title, url: source.url, provider: source.provider,
  });
  expect(JSON.stringify(summary(fixture.store.session(fixture.id)))).not.toContain("Source body");
  await fixture.restart();
  expect(fixture.store.session(fixture.id).session.inboxAsk).toEqual(source);
  expect(fixture.engine.command(fixture.command)).toEqual(fixture.receipt);
});

it("adds source instructions to first and resumed turns while retaining plain user blocks", async () => {
  const fixture = await setup();
  for (const [index, text] of ["Explain the PR", "What about tests?"].entries()) {
    fixture.engine.command({ type: "send", commandId: `send-${index}`, sessionId: fixture.id, text });
    await vi.waitFor(() => expect(fixture.turns).toHaveLength(index + 1));
    expect(fixture.turns[index].input.text).toBe(inboxPrompt(source, text));
    expect(fixture.turns[index].input.text).toContain("Do not clone repositories");
    expect(fixture.store.session(fixture.id).session.blocks.filter(block => block.role === "user").at(-1)?.text).toBe(text);
    fixture.turns[index].finish();
    await vi.waitFor(() => expect(fixture.store.session(fixture.id).status).toBe("idle"));
    if (index === 0) await fixture.restart();
  }
});

it("preserves source context when steering without adding the instructions to transcript text", async () => {
  const { engine, store, provider, turns, id } = await setup();
  engine.command({ type: "send", commandId: "send", sessionId: id, text: "Explain the PR" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  engine.command({ type: "send", commandId: "steer", sessionId: id, text: "Focus on tests", followUpBehavior: "steer" });
  await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledOnce());
  expect(provider.steer).toHaveBeenCalledWith(expect.objectContaining({ text: inboxPrompt(source, "Focus on tests") }));
  await vi.waitFor(() => expect(store.session(id).session.blocks.some(block => block.text === "Focus on tests")).toBe(true));
});

it("keeps native slash commands raw and applies context after a provider handoff", async () => {
  const { engine, store, provider, turns, id } = await setup();
  provider.commands = { rawSlashCommands: true } as HostProvider["commands"];
  engine.command({ type: "send", commandId: "raw", sessionId: id, text: "/status" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.text).toBe("/status");
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  engine.command({ type: "configure", commandId: "switch", sessionId: id,
    harness: "claude", model: "claude:test", runtimeMode: "supervised", modelSettings: {} });
  engine.command({ type: "send", commandId: "handoff", sessionId: id, text: "Continue review" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toContain(inboxPrompt(source, "Continue review"));
  expect(store.session(id).session.inboxAsk).toEqual(source);
});

it("stops and deletes a discussion before creating a fresh discussion for the same source", async () => {
  const { engine, store, provider, turns, id, command } = await setup();
  engine.command({ type: "send", commandId: "send", sessionId: id, text: "Review" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  engine.command({ type: "cancel", commandId: "cancel", sessionId: id, runId: store.session(id).runId });
  await vi.waitFor(() => expect(store.session(id).status).not.toBe("running"));
  expect(provider.cancel).toHaveBeenCalled();
  await engine.deleteSession(id);
  expect(() => store.session(id)).toThrow();
  const next = engine.command({ ...command, commandId: "restart-inbox" });
  expect(next.sessionId).not.toBe(id);
  expect(store.session(next.sessionId).session.inboxAsk).toEqual(source);
  expect(store.session(next.sessionId).session.blocks).toEqual([]);
});

it("validates source data before creating a conversation", () => {
  const base = { type: "create", commandId: "create", projectId: "project", harness: "codex", model: "codex:test", runtimeMode: "supervised" };
  for (const inboxAsk of [null, [], { ...source, provider: "other" }, { ...source, key: "" },
    { ...source, description: 42 }, { ...source, description: "x".repeat(256_001) }, { ...source, url: "bad\0url" }])
    expect(() => parseCommand({ ...base, inboxAsk })).toThrow("Invalid inbox");
  expect(parseCommand({ ...base, inboxAsk: { ...source, url: "" } })).toMatchObject({ inboxAsk: { url: "" } });
  expect(inboxPrompt(undefined, "Ordinary message")).toBe("Ordinary message");
});
