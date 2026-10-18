import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Environment, fixtureResourceCatalog } from "../src/environment";
import { toolErrorRecovery, toolDefinitions } from "../src/tools";
import { searchMemory } from "../../thread/memory";
import { HostStore } from "../../../store";
import { HostEngine } from "../../../engine";
import { executeBotAction } from "../../thread/control";
import { DecisionSchema, type Scenario, type Decision } from "../src/schema";
import { emptyUsage, type CompletionAdapter } from "../src/adapters";
import { evaluate } from "../src/scoring";
const now = new Date("2026-10-09T09:00:00Z");
const files = [
  {
    file: "memory",
    text: "- 2026-10-08 · User prefers VS Code as an editor.\n- Undated editor note",
  },
  {
    file: "topic:profile",
    text: "- 2026-10-09 · Editors use Vim.\n- 2026-10-07 · 喜欢使用编辑器和快捷键。",
  },
  { file: "archive", text: "- 2026-09-01 · User used another editor." },
];
const fixture = {
  memory: [
    { fact: "User prefers VS Code as an editor.", date: "2026-10-08" },
    { fact: "Undated editor note" },
    { fact: "Editors use Vim.", date: "2026-10-09", topic: "profile" },
    { fact: "喜欢使用编辑器和快捷键。", date: "2026-10-07", topic: "profile" },
    { fact: "User used another editor.", date: "2026-09-01", file: "archive" },
  ],
};
function scenario(
  data: Record<string, unknown> = fixture,
  tools = ["memory.search", "memory.read"],
): Scenario {
  return {
    id: "parity-test",
    category: "memory",
    language: "en",
    support: "native",
    tier: "smoke",
    prompt: "Search artificial memory.",
    tools,
    fixture: data,
    assertions: [{ kind: "no_effects" }],
    rubric: ["grounding"],
    events: [],
    maxSteps: 4,
    allowedEffects: [],
    maxEffects: 0,
    provenance: { kind: "original", source: "synthetic-parity" },
  } as Scenario;
}
const env = () =>
  new Environment(scenario(), 1, { version: "native-parity-v2", now });
const call = (
  action: string,
  input: Record<string, unknown>,
  requestId = "search",
) => ({ action, input, requestId });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it("reproduces whole-query mismatch against searchMemory and temporary native Host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-memory-parity-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  cleanups.push(async () => {
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await Promise.all([engine.ready, engine.workflows.ready]);
  engine.assistant.store.initialize({ harness: "codex", model: "test" });
  for (const doc of files)
    engine.assistant.store.writeMemoryDoc(doc.file, doc.text);
  const native = await executeBotAction(
    engine.assistant,
    "native-search",
    "memory.search",
    { query: "preferred editor" },
    () => true,
  );
  const pure = searchMemory(files, "preferred editor");
  expect(pure.length).toBeGreaterThan(0);
  expect(native).toEqual(pure);
  for (const [index, input] of [
    { query: "absent-quasar" },
    { query: "EDITOR" },
    { query: "edito" },
    { query: "编辑器" },
    { query: "editor", limit: 1 },
    { query: "editor", since: "2026-10-08" },
  ].entries()) {
    expect(env().call(call("memory.search", input))).toEqual(
      await executeBotAction(
        engine.assistant,
        `native-${index}`,
        "memory.search",
        input,
        () => true,
      ),
    );
  }
  expect(
    new Environment(scenario(), 1).call(
      call("memory.search", { query: "preferred editor" }),
    ),
  ).toEqual([]);
  expect(
    env().call(call("memory.search", { query: "preferred editor" })),
  ).toEqual(native);
});
describe("versioned native memory semantics", () => {
  it.each([
    { query: "absent-quasar" },
    { query: "editor" },
    { query: "EDITOR" },
    { query: "edito" },
    { query: "编辑器" },
    { query: "editor", limit: 1 },
    { query: "editor", since: "2026-10-08" },
  ])("matches production result identity, rank and dates for %j", (input) => {
    expect(env().call(call("memory.search", input))).toEqual(
      searchMemory(files, input.query, input),
    );
  });
  it("normalizes relative since using deterministic fixture time", () => {
    expect(
      env().call(call("memory.search", { query: "editor", since: "1d" })),
    ).toEqual(searchMemory(files, "editor", { since: "2026-10-08" }));
  });
  it("rejects stopwords and malformed since as input errors", () => {
    expect(env().call(call("memory.search", { query: "the and" }))).toEqual({
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(
      env().call(
        call("memory.search", { query: "editor", since: "yesterday" }),
      ),
    ).toEqual({ error: { code: "INVALID_ARGUMENT" } });
  });
  it("reads resident memory separately and keeps exact topic scope", () => {
    expect(env().call(call("memory.read", {}))).toEqual({
      text: files[0].text,
      topics: ["profile"],
    });
    expect(env().call(call("memory.read", { topic: "profile" }))).toEqual({
      text: files[1].text,
    });
    expect(env().call(call("memory.read", { topic: "PROFILE" }))).toEqual({
      text: "",
    });
  });
});
it("catalog exposes only allowed resource IDs and titles with exact spelling", () => {
  const fixture = {
    documents: [
      { id: "DocA", title: "Same", text: "secret-body" },
      { id: "doca", title: "Same", text: "other-body" },
    ],
    sheets: { Budget: [["=SUM(A1:A2)", 42]], budget: [[13]] },
  };
  const catalog = fixtureResourceCatalog(
    scenario(fixture, ["fixture.read", "fixture.sheet.read"]),
  );
  expect(catalog).toEqual({
    documents: [
      { id: "DocA", title: "Same" },
      { id: "doca", title: "Same" },
    ],
    sheets: [
      { sheetId: "Budget", displayName: "Budget" },
      { sheetId: "budget", displayName: "budget" },
    ],
  });
  expect(fixtureResourceCatalog(scenario(fixture, []))).toEqual({
    documents: [],
    sheets: [],
  });
  expect(
    fixtureResourceCatalog(
      scenario({}, ["fixture.read", "fixture.sheet.read"]),
    ),
  ).toEqual({ documents: [], sheets: [] });
  expect(JSON.stringify(catalog)).not.toMatch(
    /secret-body|other-body|SUM|42|13/,
  );
});
it("keeps casing strict and records repeated permanent failures across request IDs", () => {
  const e = new Environment(
    scenario({ documents: [{ id: "DocA", title: "Same", text: "body" }] }, [
      "fixture.read",
    ]),
    1,
    { version: "native-parity-v2" },
  );
  expect(e.call(call("fixture.read", { id: "doca" }, "wrong"))).toEqual({
    error: { code: "NOT_FOUND" },
  });
  expect(e.call(call("fixture.read", { id: "doca" }, "wrong-again"))).toEqual({
    error: { code: "NOT_FOUND" },
  });
  expect(e.trace[1]).toMatchObject({
    noProgress: true,
    repeatedErrorCount: 2,
    recovery: "correct-or-stop",
  });
  expect(e.call(call("fixture.read", { id: "DocA" }, "wrong"))).toEqual({
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
  expect(
    e.call(call("fixture.read", { id: "DocA" }, "corrected")),
  ).toMatchObject({ id: "DocA" });
});
it("classifies transient/rate-limit retries, unknown reconciliation and permanent corrections", () => {
  for (const code of ["TRANSIENT", "RATE_LIMIT"])
    expect(toolErrorRecovery(code)).toBe("retry");
  for (const code of ["NOT_FOUND", "PERMISSION_DENIED", "TOOL_UNAVAILABLE"])
    expect(toolErrorRecovery(code)).toBe("correct-or-stop");
  expect(toolErrorRecovery("UNKNOWN_OUTCOME")).toBe("reconcile");
  expect(toolErrorRecovery("FIXTURE_ERROR")).toBe("stop");
});
it("does not cache NOT_FOUND and replays successful sheet changes once with literal formulas", () => {
  const e = new Environment(
    scenario({ sheets: {} }, ["fixture.sheet.read", "fixture.sheet.write"]),
    1,
    { version: "native-parity-v2" },
  );
  const lookup = call("fixture.sheet.read", { sheet: "SheetA" }, "lookup");
  expect(e.call(lookup)).toEqual({ error: { code: "NOT_FOUND" } });
  const write = call(
    "fixture.sheet.write",
    { sheet: "SheetA", cells: [["=external_formula()"]] },
    "write",
  );
  const result = e.call(write);
  expect(e.call(write)).toEqual(result);
  expect(e.effects).toHaveLength(1);
  expect(e.call(lookup)).toEqual({
    sheet: "SheetA",
    cells: [["=external_formula()"]],
  });
});

it("v2 supports native since-only searches without changing the historical tool schema", () => {
  expect(env().call(call("memory.search", { since: "2026-10-08" }))).toEqual(
    searchMemory(files, "", { since: "2026-10-08" }),
  );
  expect(
    new Environment(scenario(), 1).call(
      call("memory.search", { since: "2026-10-08" }),
    ),
  ).toEqual({ error: { code: "INVALID_ARGUMENT" } });
  const legacy = toolDefinitions(["memory.search"])[0].parameters;
  const native = toolDefinitions(["memory.search"], {
    version: "native-parity-v2",
  })[0].parameters;
  expect(legacy.required).toContain("query");
  expect(native.required ?? []).not.toContain("query");
});
it("keeps historical trace shape and validates repeated denial/unavailability without effects", () => {
  const legacy = new Environment(scenario({}, ["fixture.read"]), 1);
  legacy.call(call("fixture.read", { id: "missing" }));
  expect(legacy.trace[0]).not.toHaveProperty("noProgress");
  for (const [field, code] of [
    ["denied", "PERMISSION_DENIED"],
    ["unavailable", "TOOL_UNAVAILABLE"],
  ]) {
    const e = new Environment(
      scenario({ [field]: ["fixture.read"] }, ["fixture.read"]),
      1,
      { version: "native-parity-v2" },
    );
    e.call(call("fixture.read", { id: "missing" }, "one"));
    expect(e.call(call("fixture.read", { id: "missing" }, "two"))).toEqual({
      error: { code },
    });
    expect(e.trace[1]).toMatchObject({
      noProgress: true,
      recovery: "correct-or-stop",
    });
    expect(e.effects).toHaveLength(0);
  }
});
it("transient retries remain distinguishable from unknown outcomes and ledger reconciliation", () => {
  const e = new Environment(
    scenario(
      {
        faults: [
          { action: "fixture.sheet.write", code: "TRANSIENT", remaining: 1 },
          {
            action: "fixture.sheet.write",
            code: "UNKNOWN_OUTCOME",
            remaining: 1,
            afterCommit: true,
          },
        ],
      },
      ["fixture.sheet.write", "actions.get"],
    ),
    1,
    { version: "native-parity-v2" },
  );
  const write = call(
    "fixture.sheet.write",
    { sheet: "A", cells: [["literal"]] },
    "write",
  );
  expect(e.call(write)).toEqual({ error: { code: "TRANSIENT" } });
  expect(e.trace[0]).toMatchObject({ recovery: "retry", noProgress: false });
  expect(e.call(write)).toEqual({ error: { code: "UNKNOWN_OUTCOME" } });
  expect(e.trace[1]).toMatchObject({
    recovery: "reconcile",
    noProgress: false,
  });
  expect(
    e.call(call("actions.get", { requestId: "write" }, "lookup")),
  ).toMatchObject({ state: "completed", result: { updated: true } });
  expect(e.call(write)).toEqual({ updated: true });
  expect(e.effects).toHaveLength(1);
});

// Software transport regression: no provider process or model is involved.
async function scriptedReplay(e: Environment, steps: Decision[]) {
  let index = 0;
  const adapter: CompletionAdapter = {
    model: "scripted-software-regression",
    complete: async () => ({
      text: JSON.stringify(steps[index++]),
      usage: emptyUsage(),
    }),
  };
  const transcript: unknown[] = [];
  let final = "";
  for (const _step of steps) {
    const response = await adapter.complete(
      "Isolated synthetic test",
      JSON.stringify({
        catalog: fixtureResourceCatalog(e.scenario),
        transcript,
      }),
    );
    const decision = DecisionSchema.parse(JSON.parse(response.text));
    for (const request of decision.calls) transcript.push(e.call(request));
    if (decision.final !== undefined) final = decision.final;
  }
  return final;
}
it("scripted catalog access completes a document task while needless ID clarification fails", async () => {
  const c = scenario(
    {
      documents: [
        {
          id: "DocCaseA",
          title: "Launch note",
          text: "Approved artificial date is October 13.",
        },
      ],
    },
    ["fixture.read"],
  );
  c.assertions = [
    { kind: "call", action: "fixture.read", success: true, min: 1 },
    { kind: "contains", values: ["October 13"] },
  ];
  const e = new Environment(c, 1, { version: "native-parity-v2" });
  const id = fixtureResourceCatalog(c).documents[0].id;
  const final = await scriptedReplay(e, [
    { calls: [call("fixture.read", { id }, "read")] },
    { calls: [], final: "October 13" },
  ]);
  expect(evaluate(c, e, final).passed).toBe(true);
  const needless = new Environment(c, 1, { version: "native-parity-v2" });
  expect(
    evaluate(
      c,
      needless,
      await scriptedReplay(needless, [
        { calls: [], final: "Please provide the document ID." },
      ]),
    ).passed,
  ).toBe(false);
});
it("scripted missing-catalog limitation passes without inventing a resource or reading content", async () => {
  const c = scenario({}, []);
  c.assertions = [
    { kind: "contains", values: ["Please provide the document ID"] },
    { kind: "no_effects" },
  ];
  const e = new Environment(c, 1, { version: "native-parity-v2" });
  expect(fixtureResourceCatalog(c)).toEqual({ documents: [], sheets: [] });
  const final = await scriptedReplay(e, [
    { calls: [], final: "Please provide the document ID and access." },
  ]);
  expect(evaluate(c, e, final).passed).toBe(true);
  expect(e.trace).toHaveLength(0);
});
it("scripted permanent failures cannot be rescued by casing guesses, then fresh discovered input succeeds", async () => {
  const c = scenario({ sheets: { Budget: [["=external_formula()"]] } }, [
    "fixture.sheet.read",
  ]);
  const e = new Environment(c, 1, { version: "native-parity-v2" });
  const sheet = fixtureResourceCatalog(c).sheets[0].sheetId;
  await scriptedReplay(e, [
    { calls: [call("fixture.sheet.read", { sheet: "budget" }, "bad")] },
    { calls: [call("fixture.sheet.read", { sheet: "budget" }, "bad-again")] },
    { calls: [call("fixture.sheet.read", { sheet }, "corrected")] },
    { calls: [], final: "Read the literal formula." },
  ]);
  expect(e.trace[1]).toMatchObject({
    noProgress: true,
    result: { error: { code: "NOT_FOUND" } },
  });
  expect(e.trace[2].result).toEqual({
    sheet: "Budget",
    cells: [["=external_formula()"]],
  });
  expect(e.effects).toHaveLength(0);
});

it.each([{ query: " ", since: "2026-10-08" }, { query: "editor\0" }])(
  "rejects native-invalid query text %j",
  (input) => {
    expect(env().call(call("memory.search", input))).toEqual({
      error: { code: "INVALID_ARGUMENT" },
    });
  },
);

it.each(["fixture-v1", "native-parity-v2"] as const)(
  "%s rejects an invalid calendar end without committing an event",
  (version) => {
    const e = new Environment(scenario({}, ["fixture.calendar.create"]), 1, {
      version,
    });
    const input = {
      title: "Meeting",
      start: "2026-10-09T10:00:00Z",
      end: "not-a-date",
      attendees: [],
    };
    expect(
      e.call(call("fixture.calendar.create", input, "invalid-end")),
    ).toEqual({
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(e.state.calendar).toEqual([]);
    expect(e.effects).toEqual([]);
    expect(
      e.call(
        call(
          "fixture.calendar.create",
          {
            ...input,
            end: "2026-10-09T11:00:00Z",
          },
          "valid-end",
        ),
      ),
    ).toEqual({ created: true });
    expect(e.state.calendar).toHaveLength(1);
    expect(e.effects).toHaveLength(1);
  },
);
