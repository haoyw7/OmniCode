import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { hostProviders, type HostProvider } from "./providers";
import { validateHostProvider } from "./interactionCapabilities";
import { NO_INTERACTION_CAPABILITIES } from "../src/integrations/harness/core/capabilities";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-capabilities-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Capabilities");
  const provider: HostProvider = {
    interactionCapabilities: structuredClone(hostProviders.codex.interactionCapabilities),
    send: vi.fn(async () => {}), cancel: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    steer: vi.fn(async () => {}), compact: vi.fn(async () => {}), bind: vi.fn(), approve: vi.fn(),
    answer: vi.fn(), keepQuestionOpen: vi.fn(),
  };
  const engines: HostEngine[] = [];
  const start = async () => {
    const engine = new HostEngine(store, { codex: provider }, undefined, {
      native: { environment: { home: join(directory, "home"), env: {} } },
    });
    engines.push(engine);
    await engine.ready;
    return engine;
  };
  cleanups.push(async () => {
    for (const engine of engines) { await engine.workflows.ready; await engine.close(); }
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const engine = await start();
  const { sessionId: id } = engine.command({ type: "create", commandId: "create", projectId: project.id,
    harness: "codex", model: "codex:test", runtimeMode: "supervised" });
  return { store, provider, engine, start, id };
}

describe("Host interaction capabilities", () => {
  it("validates real bindings without starting providers, including Pi and OMP", () => {
    for (const provider of Object.values(hostProviders)) expect(() => validateHostProvider(provider)).not.toThrow();
    for (const name of ["codex", "pi", "omp", "opencode"] as const)
      expect(hostProviders[name].interactionCapabilities.turns.rewindLastTurn).toBe(false);
    expect(hostProviders.codex.keepQuestionOpen).toBeTypeOf("function");
    expect(hostProviders.codex.interactionCapabilities.questions.keepOpen).toBe(true);
    expect(() => validateHostProvider({ ...hostProviders.codex, keepQuestionOpen: undefined })).toThrow("keepOpen");
    expect(() => validateHostProvider({ ...hostProviders.fx, interactionCapabilities: {
      ...hostProviders.fx.interactionCapabilities, questions: { respond: true, keepOpen: false, lateReply: false },
    } })).toThrow("respond");
  });

  it("publishes capabilities in creation snapshots and summaries with legacy aliases", async () => {
    const { store, id } = await setup();
    expect(store.session(id)).toMatchObject({ supportsQueue: true, canSteer: true,
      interactionCapabilities: { queue: true, turns: { compact: true, rewindLastTurn: false }, questions: { keepOpen: true } } });
    expect(store.summaries()[0].interactionCapabilities).toEqual(store.session(id).interactionCapabilities);
    expect(store.sync(id)).toMatchObject({ kind: "snapshot", value: { interactionCapabilities: store.session(id).interactionCapabilities } });
  });

  it("recovers old capabilities once without changing activity, replies or transcript", async () => {
    const { engine, start, store, id } = await setup();
    await engine.close();
    const initial = store.session(id);
    store.save({ ...initial, revision: initial.revision + 1, updatedAt: 123, interactionCapabilities: undefined }, { type: "fixture.legacy" });
    const before = store.session(id);
    const restarted = await start();
    const after = store.session(id);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.updatedAt).toBe(123);
    expect(after.lastReplyRevision).toBe(before.lastReplyRevision);
    expect(store.sync(id, before.revision)).toMatchObject({ kind: "delta", blocks: [],
      value: { interactionCapabilities: after.interactionCapabilities } });
    await restarted.close();
    await start();
    expect(store.sync(id, after.revision)).toEqual({ kind: "unchanged", revision: after.revision });
  });

  it("rejects disabled commands before invoking installed methods", async () => {
    const { engine, provider, id } = await setup();
    provider.interactionCapabilities = structuredClone(NO_INTERACTION_CAPABILITIES);
    expect(() => engine.command({ type: "send", commandId: "disabled-send", sessionId: id, text: "Hello" })).toThrow("Turn submission");
    expect(() => engine.command({ type: "compact", commandId: "disabled-compact", sessionId: id })).toThrow("compaction is unavailable");
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.compact).not.toHaveBeenCalled();
  });
});
