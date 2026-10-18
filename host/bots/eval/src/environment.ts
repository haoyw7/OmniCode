import { CallSchema, type Call, type Scenario, type Trace } from "./schema";
import { toolSchemas, MUTATIONS, toolErrorRecovery } from "./tools";
import { searchMemory, sinceDate, topicName } from "../../thread/memory";

export type EnvironmentVersion = "fixture-v1" | "native-parity-v2";
export type EnvironmentOptions = {
  version?: EnvironmentVersion;
  now?: Date;
  timeZone?: string;
};
export type FixtureResourceCatalog = {
  documents: { id: string; title: string }[];
  sheets: { sheetId: string; displayName: string }[];
};
/** Discovery metadata only: no content, assertions, or answer-resource hints. */
export function fixtureResourceCatalog(
  scenario: Scenario,
): FixtureResourceCatalog {
  return {
    documents: scenario.tools.includes("fixture.read")
      ? (scenario.fixture.documents ?? []).map(({ id, title }) => ({
          id,
          title,
        }))
      : [],
    sheets: scenario.tools.some((name) =>
      ["fixture.sheet.read", "fixture.sheet.write"].includes(name),
    )
      ? Object.keys(scenario.fixture.sheets ?? {}).map((sheetId) => ({
          sheetId,
          displayName: sheetId,
        }))
      : [],
  };
}
/** Mirrors native resident → sorted topics → archive order, retaining line identity. */
function memoryDocuments(entries: NonNullable<Scenario["fixture"]["memory"]>) {
  const docs = new Map<string, string[]>([
    ["memory", []],
    ["archive", []],
  ]);
  for (const entry of entries) {
    const file =
      entry.file ??
      (entry.topic === undefined
        ? "memory"
        : `topic:${topicName(entry.topic)}`);
    const lines = docs.get(file) ?? [];
    lines.push(
      `- ${entry.date ? `${entry.date} · ` : ""}${entry.fact}${entry.until ? ` · until ${entry.until}` : ""}`,
    );
    docs.set(file, lines);
  }
  return [
    "memory",
    ...[...docs.keys()].filter((file) => file.startsWith("topic:")).sort(),
    "archive",
  ].map((file) => ({ file, text: docs.get(file)!.join("\n") }));
}
const clone = <T>(v: T): T => structuredClone(v);
function canonical(x: any): string {
  return JSON.stringify(
    x && typeof x === "object"
      ? Array.isArray(x)
        ? x.map((v) => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, JSON.parse(canonical(x[k]))]),
          )
      : x,
  );
}
const fail = (code: string) => ({ error: { code } });
export class Environment {
  state: any;
  trace: Trace[] = [];
  effects: Trace[] = [];
  private ledger = new Map<string, { signature: string; result: any }>();
  readonly version: EnvironmentVersion;
  private now: Date;
  private timeZone: string;
  private requests = new Map<string, string>();
  private errors = new Map<string, number>();
  private counter = 0;
  private faults: any[];
  constructor(
    public scenario: Scenario,
    public seed: number,
    options: EnvironmentOptions = {},
  ) {
    this.version = options.version ?? "fixture-v1";
    this.now = new Date(options.now ?? "2026-10-09T09:00:00Z");
    this.timeZone = options.timeZone ?? "UTC";
    this.state = {
      projects: [{ id: "p1", name: "Atlas" }],
      sessions: [],
      files: {},
      documents: [],
      sheets: {},
      memory: [],
      chat: [],
      reminders: [],
      habits: [],
      playbooks: [],
      contacts: [],
      inbox: [],
      drafts: [],
      sent: [],
      calendar: [],
      attachments: [],
      ...clone(scenario.fixture),
    };
    this.faults = clone((scenario.fixture.faults as any[]) ?? []);
  }
  call(raw: Call) {
    let result: any,
      effect = false;
    const parsed = CallSchema.safeParse(raw);
    const schemas = toolSchemas({ version: this.version });
    const call = clone(raw);
    try {
      if (!parsed.success) result = fail("INVALID_ARGUMENT");
      else if (
        this.version === "native-parity-v2" &&
        this.conflictingRequest(call)
      )
        result = fail("IDEMPOTENCY_CONFLICT");
      else if (
        !this.scenario.tools.includes(call.action) ||
        !schemas[call.action] ||
        this.state.unavailable?.includes(call.action)
      )
        result = fail("TOOL_UNAVAILABLE");
      else if (this.state.denied?.includes(call.action))
        result = fail("PERMISSION_DENIED");
      else if (!schemas[call.action].safeParse(call.input).success)
        result = fail("INVALID_ARGUMENT");
      else if (call.input.projectId && call.input.projectId !== "p1")
        result = fail("PROJECT_SCOPE_DENIED");
      else {
        const signature = canonical({ action: call.action, input: call.input }),
          previous = this.ledger.get(call.requestId);
        if (previous)
          result =
            previous.signature === signature
              ? clone(previous.result)
              : fail("IDEMPOTENCY_CONFLICT");
        else {
          const fault = this.faults.find(
            (f) => f.action === call.action && f.remaining > 0,
          );
          if (fault) fault.remaining--;
          if (fault && !fault.afterCommit) result = fail(fault.code);
          else {
            result = this.apply(call);
            effect = MUTATIONS.has(call.action) && !result?.error;
            if (!result?.error)
              this.ledger.set(call.requestId, {
                signature,
                result: clone(result),
              });
            if (fault) result = fail(fault.code);
          }
        }
      }
    } catch {
      result = fail("FIXTURE_ERROR");
    }
    const row: Trace = {
      index: this.trace.length,
      call,
      result: clone(result),
      effect,
    };
    if (this.version === "native-parity-v2") {
      const signature = canonical({ action: call.action, input: call.input });
      if (result?.error) {
        const code = String(result.error.code),
          key = `${signature}:${code}`;
        const count = (this.errors.get(key) ?? 0) + 1;
        this.errors.set(key, count);
        row.recovery = toolErrorRecovery(code);
        row.repeatedErrorCount = count;
        row.noProgress =
          count > 1 && !["retry", "reconcile"].includes(row.recovery);
      } else {
        for (const key of this.errors.keys())
          if (key.startsWith(`${signature}:`)) this.errors.delete(key);
      }
    }
    this.trace.push(row);
    if (effect) this.effects.push(row);
    return clone(result);
  }
  private conflictingRequest(call: Call): boolean {
    const signature = canonical({ action: call.action, input: call.input });
    const previous = this.requests.get(call.requestId);
    if (previous !== undefined) return previous !== signature;
    this.requests.set(call.requestId, signature);
    return false;
  }
  private id(prefix: string) {
    return `${prefix}-${this.seed}-${++this.counter}`;
  }
  private apply({ action, input: i }: Call): any {
    const s = this.state;
    const path = (i.args as any)?.path;
    if (
      path &&
      (path.startsWith("/") ||
        path.split(/[\\/]/).includes("..") ||
        path.includes("\0"))
    )
      return fail("PATH_ESCAPE");
    const findSession = () => s.sessions.find((x: any) => x.id === i.sessionId);
    switch (action) {
      case "agents.list":
        return {
          providers: ["claude", "codex"],
          capabilities: this.scenario.tools,
        };
      case "models.list":
        return {
          models: {
            claude: [{ id: "fixture-model", name: "Fixture model" }],
            codex: [{ id: "fixture-model", name: "Fixture model" }],
          },
        };
      case "projects.list":
        return clone(s.projects);
      case "files.list":
        return Object.keys(s.files).filter(
          (k) => path === "." || k.startsWith(path),
        );
      case "files.search":
        return Object.entries(s.files)
          .filter(([k, v]) =>
            `${k} ${v}`
              .toLowerCase()
              .includes(String((i.args as any).query).toLowerCase()),
          )
          .map(([path, text]) => ({ path, text }));
      case "files.read":
        return Object.hasOwn(s.files, path)
          ? { path, text: s.files[path] }
          : fail("NOT_FOUND");
      case "files.write":
        s.files[path] = (i.args as any).content;
        return { path, written: true };
      case "files.delete":
        if (!Object.hasOwn(s.files, path)) return fail("NOT_FOUND");
        delete s.files[path];
        return { deleted: path };
      case "sessions.list":
        return { sessions: clone(s.sessions) };
      case "sessions.get":
        return clone(findSession() ?? fail("NOT_FOUND"));
      case "sessions.create": {
        const id = this.id("session");
        s.sessions.push({
          id,
          projectId: i.projectId,
          harness: i.harness,
          model: i.model,
          status: "idle",
          messages: [],
          runId: "run-1",
        });
        return { sessionId: id };
      }
      case "sessions.send":
      case "sessions.steer":
      case "sessions.cancel":
      case "sessions.approve": {
        const session = findSession();
        if (!session) return fail("NOT_FOUND");
        if (i.runId && i.runId !== session.runId) return fail("STALE_RUN");
        if (action === "sessions.send" && session.status === "running")
          return fail("BUSY");
        if (action === "sessions.steer" && session.status !== "running")
          return fail("NOT_RUNNING");
        if (action === "sessions.approve" && i.requestId !== session.approvalId)
          return fail("STALE_APPROVAL");
        if (
          i.playbooks &&
          !([i.playbooks].flat() as string[]).every((name) =>
            s.playbooks.some((p: any) => p.name === name),
          )
        )
          return fail("NOT_FOUND");
        if (action === "sessions.cancel") session.status = "cancelled";
        else if (action === "sessions.approve") session.decision = i.decision;
        else {
          session.messages ??= [];
          session.messages.push(i.text);
          session.status = "running";
        }
        return { accepted: true, sessionId: session.id };
      }
      case "memory.read":
        if (this.version === "native-parity-v2") {
          try {
            const docs = memoryDocuments(s.memory);
            const file =
              i.topic === undefined
                ? "memory"
                : `topic:${topicName(String(i.topic))}`;
            return {
              text: docs.find((doc) => doc.file === file)?.text ?? "",
              ...(file === "memory"
                ? {
                    topics: docs
                      .filter(
                        (doc) => doc.file.startsWith("topic:") && doc.text,
                      )
                      .map((doc) => doc.file.slice(6)),
                  }
                : {}),
            };
          } catch {
            return fail("INVALID_ARGUMENT");
          }
        }
        return {
          text: s.memory
            .filter((x: any) => !i.topic || x.topic === i.topic)
            .map((x: any) => x.fact)
            .join("\n"),
        };
      case "memory.search":
        if (this.version === "native-parity-v2") {
          try {
            return searchMemory(
              memoryDocuments(s.memory),
              i.query === undefined ? "" : String(i.query),
              {
                ...(i.limit === undefined ? {} : { limit: Number(i.limit) }),
                ...(i.since === undefined
                  ? {}
                  : {
                      since: sinceDate(
                        String(i.since),
                        this.now,
                        this.timeZone,
                      ),
                    }),
              },
            );
          } catch {
            return fail("INVALID_ARGUMENT");
          }
        }
        return s.memory.filter((x: any) =>
          x.fact.toLowerCase().includes(String(i.query).toLowerCase()),
        );
      case "chat.search":
        return s.chat.filter((x: any) =>
          x.text.toLowerCase().includes(String(i.query).toLowerCase()),
        );
      case "memory.add":
        s.memory.push(clone(i));
        return { saved: true };
      case "memory.replace":
      case "memory.remove": {
        const hits = s.memory.filter((x: any) => x.fact.includes(i.find));
        if (hits.length !== 1) return fail("AMBIGUOUS_MATCH");
        const index = s.memory.indexOf(hits[0]);
        if (action === "memory.remove") s.memory.splice(index, 1);
        else s.memory[index] = { ...hits[0], fact: i.fact };
        return { updated: true };
      }
      case "reminders.list":
        return clone(s.reminders);
      case "reminders.create": {
        const id = this.id("reminder");
        s.reminders.push({ id, ...clone(i) });
        return { reminderId: id };
      }
      case "reminders.cancel": {
        const index = s.reminders.findIndex((x: any) => x.id === i.reminderId);
        if (index < 0) return fail("NOT_FOUND");
        s.reminders.splice(index, 1);
        return { cancelled: true };
      }
      case "habits.list":
        return clone(s.habits);
      case "habits.create": {
        const id = this.id("habit");
        s.habits.push({ id, enabled: true, ...clone(i) });
        return { habitId: id };
      }
      case "habits.update":
      case "habits.delete": {
        const index = s.habits.findIndex((x: any) => x.id === i.habitId);
        if (index < 0) return fail("NOT_FOUND");
        if (action === "habits.delete") s.habits.splice(index, 1);
        else s.habits[index] = { ...s.habits[index], ...clone(i) };
        return { updated: true };
      }
      case "playbooks.list":
        return s.playbooks.map(({ name, description }: any) => ({
          name,
          description,
        }));
      case "playbooks.read":
        return clone(
          s.playbooks.find((p: any) => p.name === i.name) ?? fail("NOT_FOUND"),
        );
      case "playbooks.save": {
        const index = s.playbooks.findIndex((p: any) => p.name === i.name);
        if (index < 0) s.playbooks.push(clone(i));
        else s.playbooks[index] = clone(i);
        return { saved: true };
      }
      case "actions.get": {
        const entry = this.ledger.get(String(i.requestId));
        return entry
          ? { state: "completed", result: clone(entry.result) }
          : null;
      }
      case "reply.attachments": {
        for (const source of i.sources as any[])
          if (
            source.projectId !== "p1" ||
            !Object.hasOwn(s.files, source.relativePath)
          )
            return fail("NOT_FOUND");
        s.attachments.push(...clone(i.sources as any[]));
        return { published: true, externalReceipt: false };
      }
      case "fixture.search":
        return s.documents
          .filter((x: any) =>
            `${x.title} ${x.text}`
              .toLowerCase()
              .includes(String(i.query).toLowerCase()),
          )
          .map(({ id, title }: any) => ({ id, title }));
      case "fixture.read":
        return clone(
          s.documents.find((x: any) => x.id === i.id) ?? fail("NOT_FOUND"),
        );
      case "fixture.sheet.read":
        return Object.hasOwn(s.sheets, String(i.sheet))
          ? { sheet: i.sheet, cells: clone(s.sheets[String(i.sheet)]) }
          : fail("NOT_FOUND");
      case "fixture.sheet.write":
        s.sheets[String(i.sheet)] = clone(i.cells);
        return { updated: true };
      case "fixture.contacts.search":
        return s.contacts.filter((x: any) =>
          `${x.name} ${x.email} ${x.team ?? ""}`
            .toLowerCase()
            .includes(String(i.query).toLowerCase()),
        );
      case "fixture.mail.search":
        return s.inbox.filter((x: any) =>
          `${x.subject} ${x.body}`
            .toLowerCase()
            .includes(String(i.query).toLowerCase()),
        );
      case "fixture.mail.draft": {
        const id = this.id("draft");
        s.drafts.push({ id, ...clone(i) });
        return { draftId: id };
      }
      case "fixture.mail.send": {
        const draft = s.drafts.find((x: any) => x.id === i.draftId);
        if (!draft) return fail("NOT_FOUND");
        s.sent.push(clone(draft));
        return { sent: true };
      }
      case "fixture.calendar.list":
        return s.calendar.filter((x: any) => x.start.startsWith(i.date));
      case "fixture.calendar.create": {
        const start = Date.parse(String(i.start)),
          end = Date.parse(String(i.end));
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
          return fail("INVALID_ARGUMENT");
        s.calendar.push(clone(i));
        return { created: true };
      }
      case "fixture.calculate": {
        const values = i.values as number[];
        return {
          value:
            i.operation === "multiply"
              ? values.reduce((a, b) => a * b, 1)
              : values.reduce((a, b) => a + b, 0) /
                (i.operation === "average" ? values.length : 1),
        };
      }
      default:
        return fail("TOOL_UNAVAILABLE");
    }
  }
}
