import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve, sep, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../../store";
import { HostEngine } from "../../../engine";
import type { HostProvider } from "../../../providers";
import { executeBotAction } from "../../thread/control";
import { brain } from "../native/brain";
import { toolSchemas, MUTATIONS } from "./tools";
import { CallSchema, EvalError, type Call, type Scenario } from "./schema";
import {
  NativePiFixtureAdapter,
  type NativeRun,
} from "./nativePiFixtureAdapter";

export const HOST_FIXTURE_ACTIONS = [
  "files.list",
  "files.read",
  "files.search",
  "files.write",
  "files.delete",
  "memory.read",
  "memory.search",
  "memory.add",
  "memory.replace",
  "memory.remove",
  "actions.get",
  "reminders.list",
  "reminders.create",
  "reminders.cancel",
  "habits.list",
  "habits.create",
  "habits.update",
  "habits.delete",
  "playbooks.list",
  "playbooks.read",
  "playbooks.save",
] as const;
const fixtureFields = new Set([
  "files",
  "memory",
  "denied",
  "unavailable",
  "context",
]);
export function nativeHostSupport(scenario: Scenario): {
  supported: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const action of scenario.tools)
    if (!(HOST_FIXTURE_ACTIONS as readonly string[]).includes(action))
      reasons.push(`unaudited Host action: ${action}`);
  for (const key of Object.keys(scenario.fixture))
    if (!fixtureFields.has(key))
      reasons.push(`unimplemented Host fixture: ${key}`);
  if (scenario.events.some((e) => e.patch))
    reasons.push("native event patch unsupported");
  if (scenario.fixture.memory?.some((entry) => entry.until))
    reasons.push("memory fixture expiry requires native document seeding");
  if (
    scenario.fixture.memory?.some((entry) =>
      Object.keys(entry).some((key) => !["fact", "topic"].includes(key)),
    )
  )
    reasons.push(
      "memory fixture has unsupported date/file/other document semantics",
    );
  return { supported: reasons.length === 0, reasons };
}

/** Disposable actual Host control bridge; never creates a user/provider worker session. */
export class NativeHostFixtureAdapter {
  private authorized = true;
  private closed = false;
  readonly trace: {
    index: number;
    call: Call;
    result: unknown;
    effect: boolean;
  }[] = [];
  private finishes: (() => void)[] = [];
  private constructor(
    readonly scenario: Scenario,
    readonly seed: number,
    readonly directory: string,
    readonly store: HostStore,
    readonly engine: HostEngine,
    readonly projectId: string,
  ) {}
  static support = nativeHostSupport;
  static async create(
    scenario: Scenario,
    seed: number,
  ): Promise<NativeHostFixtureAdapter> {
    const support = nativeHostSupport(scenario);
    if (!support.supported)
      throw new EvalError(`NATIVE_HOST_BLOCKED: ${support.reasons.join("; ")}`);
    const directory = await mkdtemp(join(tmpdir(), "monocode-native-host-"));
    let store: HostStore | undefined, engine: HostEngine | undefined;
    const pending: (() => void)[] = [];
    try {
      store = new HostStore(join(directory, "host.db"));
      const workspace = join(directory, "workspace");
      await mkdir(workspace);
      const project = store.addProject(workspace, "Atlas fixture");
      const stop = async () => {
        pending.splice(0).forEach((resolve) => resolve());
      };
      const provider: HostProvider = {
        send: async () => new Promise<void>((resolve) => pending.push(resolve)),
        stop,
        cancel: stop,
        bind: () => {},
        approve: () => {},
        answer: () => {},
      };
      engine = new HostEngine(store, { pi: provider });
      await engine.ready;
      engine.assistant.setCatalog(
        async () => ["pi"],
        async () => ({
          models: {
            pi: [
              {
                id: "openai-codex/gpt-5.6-luna",
                name: "Fixture Pi",
                harness: "pi",
              },
            ],
          },
          errors: {},
        }),
      );
      await engine.assistant.rpc("assistant.configure", {
        commandId: "fixture-configure",
        expectedRevision: 0,
        patch: {
          harness: "pi",
          model: "openai-codex/gpt-5.6-luna",
          timezone: "UTC",
          triggers: { user: true, event: false, schedule: false },
        },
      });
      for (const [path, content] of Object.entries(
        scenario.fixture.files ?? {},
      )) {
        const target = NativeHostFixtureAdapter.fixturePath(workspace, path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, content);
      }
      const memory = scenario.fixture.memory ?? [];
      if (memory.length) {
        engine.assistant.store.writeMemoryDoc(
          "memory",
          memory
            .filter((x) => !x.topic)
            .map((x) => x.fact)
            .join("\n"),
        );
        for (const topic of new Set(memory.map((x) => x.topic).filter(Boolean)))
          engine.assistant.store.writeMemoryDoc(
            `topic:${topic}`,
            memory
              .filter((x) => x.topic === topic)
              .map((x) => x.fact)
              .join("\n"),
          );
      }
      await engine.assistant.rpc("assistant.send", {
        commandId: "fixture-wakeup",
        text: scenario.prompt,
      });
      // Wait for the temporary Host brain to claim a genuine active wakeup before control calls.
      const deadline = Date.now() + 5000;
      while (!pending.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      if (!pending.length) throw new EvalError("HOST_WAKEUP_TIMEOUT");
      const adapter = new NativeHostFixtureAdapter(
        scenario,
        seed,
        directory,
        store,
        engine,
        project.id,
      );
      adapter.finishes = pending;
      return adapter;
    } catch (error) {
      pending.splice(0).forEach((resolve) => resolve());
      await engine?.close();
      store?.close();
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  private static fixturePath(workspace: string, path: string) {
    if (
      isAbsolute(path) ||
      path.includes("\0") ||
      path.split(/[\\/]/).includes("..")
    )
      throw new EvalError("PATH_ESCAPE");
    const target = resolve(workspace, path);
    if (target !== workspace && !target.startsWith(workspace + sep))
      throw new EvalError("PATH_ESCAPE");
    return target;
  }
  revoke() {
    this.authorized = false;
  }
  async call(raw: Call): Promise<unknown> {
    const call = CallSchema.parse(raw);
    const previous = this.closed
      ? undefined
      : this.engine.assistant.store.action(call.requestId);
    try {
      const result = await this.dispatch(call);
      this.trace.push({
        index: this.trace.length,
        call: structuredClone(call),
        result: structuredClone(result),
        effect:
          !previous && MUTATIONS.has(call.action) && !(result as any)?.error,
      });
      return result;
    } catch (error) {
      this.trace.push({
        index: this.trace.length,
        call: structuredClone(call),
        result: {
          error: {
            code: error instanceof Error ? error.message : String(error),
          },
        },
        effect: false,
      });
      throw error;
    }
  }
  private async dispatch(call: Call): Promise<unknown> {
    if (this.closed || !this.authorized)
      throw new Error("Assistant control was revoked");
    if (
      !this.scenario.tools.includes(call.action) ||
      !(HOST_FIXTURE_ACTIONS as readonly string[]).includes(call.action)
    )
      throw new EvalError("UNAUDITED_NATIVE_ACTION");
    if (
      !toolSchemas({ version: "native-parity-v2" })[call.action].safeParse(
        call.input,
      ).success
    )
      throw new EvalError("INVALID_ARGUMENT");
    let result: unknown;
    if ((this.scenario.fixture.unavailable ?? []).includes(call.action))
      result = { error: { code: "TOOL_UNAVAILABLE" } };
    else if ((this.scenario.fixture.denied ?? []).includes(call.action))
      result = { error: { code: "PERMISSION_DENIED" } };
    else {
      const input = structuredClone(call.input);
      if (input.projectId !== undefined) {
        if (input.projectId !== "p1")
          throw new EvalError("PROJECT_SCOPE_DENIED");
        input.projectId = this.projectId;
      }
      if (call.action.startsWith("files.")) {
        const args = input.args as Record<string, unknown>;
        if (typeof args.path === "string")
          args.path = NativeHostFixtureAdapter.fixturePath(
            join(this.directory, "workspace"),
            args.path,
          );
      }
      result = await executeBotAction(
        this.engine.assistant,
        call.requestId,
        call.action,
        input,
        () => this.authorized && !this.closed,
      );
    }
    return result;
  }
  async snapshot() {
    const files: Record<string, string> = {};
    const directory = join(this.directory, "workspace");
    for (const entry of await readdir(directory, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile()) {
        const path = join(entry.parentPath, entry.name);
        files[path.slice(directory.length + 1)] = await readFile(path, "utf8");
      }
    }
    return {
      files,
      memory: this.engine.assistant.store.memoryDoc("memory").text,
      reminders: this.engine.assistant.store.get()?.reminders ?? [],
      habits: this.engine.assistant.store.get()?.habits ?? [],
    };
  }
  async run(pi: NativePiFixtureAdapter): Promise<NativeRun> {
    const result = await pi.run(this.scenario, this.seed, {
      system:
        brain(this.scenario.tools, this.scenario.prompt) +
        "\nThe registered native fixture tools provide the Host actions. Call them directly; their names replace dots with double underscores.",
      call: (call) => this.call(call),
    });
    result.trace = this.trace;
    result.state = await this.snapshot();
    result.metadata.host = {
      boundary:
        "real disposable HostEngine active wakeup plus executeAssistantAction; Pi SDK fixture bridge",
      provider:
        "fixture provider holds Host brain; SDK loop runs independently",
      workerSessions: false,
      productionPiFamilyTransport: false,
      persistedProviderRecovery: false,
    };
    return result;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.authorized = false;
    this.finishes.splice(0).forEach((resolve) => resolve());
    await this.engine.close();
    this.store.close();
    await rm(this.directory, { recursive: true, force: true });
  }
}
