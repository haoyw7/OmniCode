import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import {
  buildDeterministicHandoff,
  pendingHandoff,
  wrapHandoffPrompt,
} from "../src/features/sessions/model/handoff";
import { HostEngine, parseCommand } from "./engine";
import type { HostProvider } from "./providers";
import { HostSkills } from "./skills";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Turn = {
  input: SendTurnInput;
  finish: () => void;
  fail: (reason: Error) => void;
};

async function setup(harness: "codex" | "claude" | "pi" | "omp" = "codex") {
  const directory = mkdtempSync(join(tmpdir(), "monocode-harness-switch-"));
  const profiles = join(directory, "provider-accounts");
  for (const provider of ["codex", "claude"])
    mkdirSync(join(profiles, provider, `target-${provider}`), { recursive: true });
  writeFileSync(join(directory, "desktop-owner.json"), JSON.stringify({ desktopDirectory: directory }));
  writeFileSync(join(profiles, "accounts.json"), JSON.stringify({
    codex: [{ id: "target-codex", label: "Target Codex" }],
    claude: [{ id: "target-claude", label: "Target Claude" }],
  }));
  writeFileSync(join(profiles, "defaults.json"), JSON.stringify({
    codex: "target-codex", claude: "target-claude",
  }));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Switch test");
  const turns: Partial<Record<RemoteProvider, Turn[]>> = {};
  const providers: Partial<Record<RemoteProvider, HostProvider>> = {};
  const gates: Array<() => void> = [];
  for (const id of ["codex", "claude", "pi", "omp"] as const) {
    const received: Turn[] = [];
    turns[id] = received;
    providers[id] = {
      send: vi.fn((input) => new Promise<void>((finish, fail) => {
        received.push({ input, finish, fail });
      })),
      cancel: vi.fn(async () => received.at(-1)?.finish()),
      stop: vi.fn(async () => received.at(-1)?.finish()),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
      readSessionTitle: vi.fn(async () => null),
    };
  }
  const engine = new HostEngine(store, providers, undefined, {
    native: { environment: { home: join(directory, "home"), env: {} } },
  });
  engine.nativeSessions.setAutoSync(false);
  await engine.ready;
  const created = engine.command({
    type: "create", commandId: "create", projectId: project.id,
    harness, model: `${harness}:old`, runtimeMode: "supervised",
  });
  const id = created.sessionId;
  cleanups.push(async () => {
    for (const release of gates) release();
    for (const received of Object.values(turns)) for (const turn of received) turn.finish();
    await engine.workflows.ready;
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const configure = (target?: RemoteProvider, commandId = "switch") => engine.command({
    type: "configure", commandId, sessionId: id,
    ...(target ? { harness: target } : {}),
    model: `${target ?? harness}:new`, modelSettings: { reasoningEffort: "high" },
    runtimeMode: "full-access",
  });
  const send = (text: string, commandId = "send") => engine.command({
    type: "send", commandId, sessionId: id, text,
  });
  const seedHistory = (native = false) => {
    const current = store.session(id);
    const providerSessionId = "old-native-session";
    const session = {
      ...current.session,
      title: "Existing work",
      providerSessionId,
      providerAccountId: "old-account",
      context: { used: 1234, window: 100000 },
      modelSettingOptions: { model: current.session.model, settings: [] },
      blocks: [
        { id: "old-user", role: "user" as const, text: "Add a settings page" },
        { id: "old-assistant", role: "assistant" as const, text: "The page is implemented; keyboard navigation remains." },
      ],
      ...(native ? {
        nativeSession: {
          provider: harness,
          providerSessionId,
          path: join(directory, "old.jsonl"), revision: "old-revision",
          createdAt: 1, updatedAt: 1, blockIds: ["old-user", "old-assistant"],
        },
        nativeSyncStatus: { state: "ready" as const, checkedAt: 1 },
      } : {}),
    };
    store.save({
      ...current, revision: current.revision + 1, session,
      ...(native ? {
        nativeBinding: { provider: harness, providerSessionId, path: join(directory, "old.jsonl") },
        nativeStatus: { state: "ready" as const, checkedAt: 1 },
      } : {}),
    }, { type: "test.history" });
    return session;
  };
  return { engine, store, providers, turns, id, configure, send, seedHistory, gates };
}

describe("Host cross-harness handoff", () => {
  it.each(["codex", "claude", "pi", "omp"] as const)(
    "switches to %s with retained history and a fresh provider identity",
    async (target) => {
      const source = target === "codex" ? "claude" : "codex";
      const { store, providers, turns, id, configure, send, seedHistory } = await setup(source);
      const before = seedHistory(true);
      const brief = buildDeterministicHandoff(before);
      const receipt = configure(target);
      expect(configure(target)).toEqual(receipt);
      const selected = store.session(id);
      expect(selected.session).toEqual({ ...before, pendingConfiguration: {
        harness: target, model: `${target}:new`,
        modelSettings: { reasoningEffort: "high" }, runtimeMode: "full-access",
      } });
      expect(selected.nativeBinding).toBeDefined();
      expect(providers[source]!.stop).not.toHaveBeenCalled();
      expect(pendingHandoff(selected.session)).toBeNull();
      send("Finish keyboard navigation");
      const switched = store.session(id);
      expect(switched.session).toMatchObject({
        id, title: "Existing work", harness: target, model: `${target}:new`,
        modelSettings: { reasoningEffort: "high" }, runtimeMode: "full-access",
      });
      expect(switched.session.blocks.slice(0, before.blocks.length)).toEqual(before.blocks);
      expect(switched.session.providerSessionId).toBeUndefined();
      expect(switched.session.providerAccountId).toBe(
        target === "codex" || target === "claude" ? `target-${target}` : undefined,
      );
      expect(switched.session.context).toBeUndefined();
      expect(switched.session.modelSettingOptions).toBeUndefined();
      expect(switched.session.nativeSession).toBeUndefined();
      expect(switched.session.nativeSyncStatus).toBeUndefined();
      expect(switched.nativeBinding).toBeUndefined();
      expect(switched.nativeStatus).toBeUndefined();
      expect(pendingHandoff(switched.session)).toEqual({ from: source, to: target, text: brief });
      expect(switched.session.blocks.filter(block => block.role === "handoff")).toHaveLength(1);
      expect(switched.session.pendingConfiguration).toBeUndefined();
      await vi.waitFor(() => expect(turns[target]).toHaveLength(1));
      expect(providers[source]!.stop).toHaveBeenCalledOnce();
      expect(providers[target]!.bind).not.toHaveBeenCalled();
      expect(turns[target]![0].input).toMatchObject({
        sessionId: id,
        text: wrapHandoffPrompt(brief, source, "Finish keyboard navigation"),
        providerAccountId: target === "codex" || target === "claude" ? `target-${target}` : undefined,
      });
      turns[target]![0].input.onEvent({ type: "session.providerBound", providerSessionId: "new-native-session" });
      turns[target]![0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
      expect(pendingHandoff(store.session(id).session)).toBeNull();
      expect(store.session(id).session.providerSessionId).toBe("new-native-session");
      send("Another request", "second-send");
      await vi.waitFor(() => expect(turns[target]).toHaveLength(2));
      expect(turns[target]![1].input.text).toBe("Another request");
      turns[target]![1].finish();
    },
  );

  it.each(["native", "manual"] as const)("preserves %s title ownership when switching agents", async (source) => {
    const { store, id, configure, seedHistory, send } = await setup();
    seedHistory();
    const current = store.session(id);
    store.save({ ...current, revision: current.revision + 1, session: {
      ...current.session, title: "codex · Keyboard navigation",
      titleState: { source, epoch: 2, purpose: "initial", fallbackAttempted: false },
    } }, { type: "test" });
    configure("pi");
    expect(store.session(id).session.title).toBe("codex · Keyboard navigation");
    send("Continue");
    expect(store.session(id).session.title).toBe(source === "manual"
      ? "codex · Keyboard navigation" : "pi · Keyboard navigation");
  });

  it("retargets and cancels a selection without touching the original conversation", async () => {
    const { store, providers, turns, id, configure, send, seedHistory } = await setup();
    const before = seedHistory(true);
    configure("claude");
    configure("omp", "retarget");
    expect(store.session(id).session).toEqual({ ...before, pendingConfiguration: {
      harness: "omp", model: "omp:new", modelSettings: { reasoningEffort: "high" }, runtimeMode: "full-access",
    } });
    configure("codex", "revert");
    expect(store.session(id).session).toMatchObject({
      harness: "codex", providerSessionId: before.providerSessionId,
      providerAccountId: before.providerAccountId, blocks: before.blocks,
      nativeSession: before.nativeSession, context: before.context,
    });
    expect(store.session(id).session.pendingConfiguration).toBeUndefined();
    for (const provider of Object.values(providers)) expect(provider.stop).not.toHaveBeenCalled();
    send("Keep going");
    await vi.waitFor(() => expect(turns.codex).toHaveLength(1));
    expect(turns.codex![0].input.text).toBe("Keep going");
    expect(pendingHandoff(store.session(id).session)).toBeNull();
  });

  it("keeps the selection pending when the send is rejected", async () => {
    const { engine, store, providers, id, configure, seedHistory } = await setup();
    const before = seedHistory();
    configure("claude");
    expect(() => engine.command({ type: "send", commandId: "invalid-send", sessionId: id,
      text: "Continue", draftBlockId: "missing-draft" })).toThrow("Draft not found");
    expect(store.session(id).session).toMatchObject({
      harness: "codex", providerSessionId: before.providerSessionId, blocks: before.blocks,
      pendingConfiguration: { harness: "claude" },
    });
    expect(providers.codex!.stop).not.toHaveBeenCalled();
    expect(providers.claude!.send).not.toHaveBeenCalled();
  });

  it("lists skills for the pending Agent before the switch applies", async () => {
    const { engine, store, id, configure, seedHistory } = await setup();
    seedHistory();
    configure("claude");
    const { projectId } = store.session(id);
    await expect(engine.listSkills(projectId, "claude", id)).resolves.toMatchObject({ native: false });
    await expect(engine.listSkills(projectId, "codex", id)).resolves.toBeDefined();
    await expect(engine.listSkills(projectId, "pi", id))
      .rejects.toThrow("The skill catalog belongs to another project or Agent");
  });

  it("changes an empty session without fabricating a handoff", async () => {
    const { store, turns, id, configure, send } = await setup();
    configure("pi");
    expect(store.session(id).session.blocks).toEqual([]);
    expect(pendingHandoff(store.session(id).session)).toBeNull();
    send("First request");
    await vi.waitFor(() => expect(turns.pi).toHaveLength(1));
    expect(turns.pi![0].input.text).toBe("First request");
    turns.pi![0].finish();
  });

  it("keeps the active provider and identity for legacy settings commands", async () => {
    const { store, providers, id, configure, seedHistory } = await setup();
    const before = seedHistory();
    configure();
    const after = store.session(id).session;
    expect(after).toMatchObject({
      harness: "codex", model: "codex:new", providerSessionId: before.providerSessionId,
      providerAccountId: before.providerAccountId, blocks: before.blocks,
    });
    expect(providers.codex!.stop).not.toHaveBeenCalled();
    expect(pendingHandoff(after)).toBeNull();
  });

  it("prepares skills only from the current request before adding the handoff recap", async () => {
    const { store, providers, turns, id, configure, send, seedHistory } = await setup();
    seedHistory();
    const previous = store.session(id);
    store.save({
      ...previous,
      revision: previous.revision + 1,
      session: {
        ...previous.session,
        blocks: previous.session.blocks.map(block => block.role === "user"
          ? { ...block, text: "/skill old-layout Add a settings page" }
          : block),
      },
    }, { type: "test.oldSkill" });
    configure("claude");
    const request = "/skill keyboard-navigation Finish the settings page";
    const prepared = "Current keyboard-navigation skill instructions\n\n" + request;
    const prepare = vi.spyOn(HostSkills.prototype, "prepare").mockResolvedValue(prepared);
    try {
      send(request);
      const handoff = pendingHandoff(store.session(id).session)!;
      expect(handoff.text).toContain("/skill old-layout");
      await vi.waitFor(() => expect(turns.claude).toHaveLength(1));
      expect(prepare).toHaveBeenCalledExactlyOnceWith(
        request,
        { harness: "claude", cwd: previous.session.cwd, sessionId: id },
        providers.claude,
      );
      expect(turns.claude![0].input.text).toBe(wrapHandoffPrompt(
        handoff.text, handoff.from, prepared,
      ));
      turns.claude![0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    } finally {
      prepare.mockRestore();
    }
  });

  it.each(["failed", "cancelled", "provider-error"] as const)(
    "retains the handoff and prior request when first delivery is %s",
    async (outcome) => {
      const { engine, store, turns, id, configure, send, seedHistory } = await setup();
      seedHistory();
      configure("claude");
      send("Try keyboard navigation");
      const handoff = pendingHandoff(store.session(id).session)!;
      await vi.waitFor(() => expect(turns.claude).toHaveLength(1));
      const first = turns.claude![0];
      if (outcome === "failed") first.fail(new Error("Delivery failed"));
      else if (outcome === "provider-error") {
        first.input.onEvent({ type: "session.error", message: "Provider rejected the request" });
        first.finish();
      } else engine.command({ type: "cancel", commandId: "cancel", sessionId: id, runId: store.session(id).runId });
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
      expect(pendingHandoff(store.session(id).session)).toEqual(handoff);
      send("Retry with the accessible controls", "retry");
      await vi.waitFor(() => expect(turns.claude).toHaveLength(2));
      expect(turns.claude![1].input.text).toBe(wrapHandoffPrompt(
        handoff.text, handoff.from, "Retry with the accessible controls", ["Try keyboard navigation"],
      ));
      turns.claude![1].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
      expect(pendingHandoff(store.session(id).session)).toBeNull();
    },
  );

  it.each(["pi", "omp"] as const)("preserves native %s slash commands and defers context until a conversational turn", async (target) => {
    const { store, providers, turns, id, configure, send, seedHistory } = await setup();
    providers[target]!.commands = { rawSlashCommands: true, discover: async () => [] };
    seedHistory();
    configure(target);
    send("/reload");
    const handoff = pendingHandoff(store.session(id).session)!;
    await vi.waitFor(() => expect(turns[target]).toHaveLength(1));
    expect(turns[target]![0].input.text).toBe("/reload");
    turns[target]![0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(pendingHandoff(store.session(id).session)).toEqual(handoff);
    send("Continue the work", "after-command");
    await vi.waitFor(() => expect(turns[target]).toHaveLength(2));
    expect(turns[target]![1].input.text).toBe(wrapHandoffPrompt(
      handoff.text, handoff.from, "Continue the work", ["/reload"],
    ));
    turns[target]![1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(pendingHandoff(store.session(id).session)).toBeNull();
  });

  it("does not start the target if the previous provider fails to stop and retries cleanup on the next send", async () => {
    const { store, providers, turns, id, configure, send, seedHistory, gates } = await setup();
    seedHistory();
    let rejectStop = () => {};
    const stopped = new Promise<void>((_resolve, reject) => {
      rejectStop = () => reject(new Error("Old process is still running"));
    });
    gates.push(rejectStop);
    providers.codex!.stop = vi.fn().mockImplementationOnce(() => stopped).mockResolvedValue(undefined);
    configure("claude");
    send("First attempt");
    const handoff = pendingHandoff(store.session(id).session)!;
    await vi.waitFor(() => expect(providers.codex!.stop).toHaveBeenCalledOnce());
    expect(providers.claude!.send).not.toHaveBeenCalled();
    rejectStop();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(providers.claude!.send).not.toHaveBeenCalled();
    expect(pendingHandoff(store.session(id).session)).toEqual(handoff);
    send("Retry after cleanup", "retry-cleanup");
    await vi.waitFor(() => expect(turns.claude).toHaveLength(1));
    expect(providers.codex!.stop).toHaveBeenCalledTimes(2);
    expect(turns.claude![0].input.text).toBe(wrapHandoffPrompt(
      handoff.text, handoff.from, "Retry after cleanup", ["First attempt"],
    ));
    turns.claude![0].finish();
  });

  it("waits for the old provider to stop before starting a target turn", async () => {
    const { store, providers, turns, id, configure, send, seedHistory, gates } = await setup();
    seedHistory();
    let release = () => {};
    const stopped = new Promise<void>(resolve => { release = resolve; });
    gates.push(release);
    providers.codex!.stop = vi.fn(() => stopped);
    configure("omp");
    send("Continue immediately");
    await vi.waitFor(() => expect(providers.codex!.stop).toHaveBeenCalledOnce());
    expect(providers.omp!.send).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(turns.omp).toHaveLength(1));
    turns.omp![0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("rejects switches both during delivery and while the old provider is settling", async () => {
    const { store, providers, turns, id, configure, send, gates } = await setup();
    delete providers.codex!.readSessionTitle;
    let release = () => {};
    const stopped = new Promise<void>(resolve => { release = resolve; });
    gates.push(release);
    providers.codex!.stop = vi.fn(() => stopped);
    send("Work in progress");
    await vi.waitFor(() => expect(turns.codex).toHaveLength(1));
    expect(() => configure("claude", "during-turn")).toThrow(/current turn/);
    turns.codex![0].finish();
    await vi.waitFor(() => expect(providers.codex!.stop).toHaveBeenCalledOnce());
    expect(() => configure("claude", "during-settlement")).toThrow(/current turn/);
    expect(store.session(id).session.harness).toBe("codex");
    release();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    configure("claude", "after-settlement");
    expect(store.session(id).session.harness).toBe("codex");
    expect(store.session(id).session.pendingConfiguration?.harness).toBe("claude");
    send("Continue with Claude", "after-switch");
    expect(store.session(id).session.harness).toBe("claude");
  });
});

describe("Host configure command compatibility", () => {
  const legacy = {
    type: "configure", commandId: "configure", sessionId: "session",
    model: "codex:new", modelSettings: {}, runtimeMode: "supervised",
  };

  it("accepts the original shape without supplying a provider", () => {
    expect(parseCommand(legacy)).toEqual(legacy);
  });

  it.each(["codex", "claude", "pi", "omp"] as const)("accepts explicit %s targets", (harness) => {
    expect(parseCommand({ ...legacy, harness })).toEqual({ ...legacy, harness });
  });

  it.each(["missing-provider", "", null, 7, {}])("rejects invalid target %j", (harness) => {
    expect(() => parseCommand({ ...legacy, harness })).toThrow(/provider|harness/i);
  });
});
