import { afterEach, expect, it } from "vitest";
import { Budget } from "../src/adapters";
import { CaseSchema } from "../src/schema";
import {
  createNativeTools,
  createRequestGate,
  isolatedPiResources,
} from "../src/nativePiFixtureAdapter";
import { NativeHostFixtureAdapter } from "../src/nativeHostFixtureAdapter";
import { freezeNativeManifest } from "../src/comparisonManifest";
const scenario = (patch: Record<string, unknown> = {}) =>
  CaseSchema.parse({
    id: "fixture",
    category: "files",
    language: "en",
    support: "native",
    tier: "standard",
    prompt: "Read note.txt",
    tools: ["files.read"],
    fixture: { files: { "note.txt": "fixture" } },
    assertions: [{ kind: "no_effects" }],
    rubric: ["safety"],
    provenance: { kind: "original", source: "native-isolation-test" },
    ...patch,
  });
it("tool whitelist exposes only strict fixture operations and cannot add a shell", async () => {
  const calls: unknown[] = [];
  const tools = createNativeTools(scenario(), async (call) => {
    calls.push(call);
    return { text: "fixture" };
  });
  expect(tools.map((t) => t.name)).toEqual(["files__read"]);
  await expect(
    tools[0].execute("id", {
      requestId: "r",
      input: { projectId: "p1", args: { path: "note.txt" }, command: "bash" },
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  expect(isolatedPiResources("neutral", {} as any).getAgentsFiles()).toEqual({
    agentsFiles: [],
  });
  expect(() =>
    createNativeTools(scenario({ tools: ["bash"] }), async () => null),
  ).toThrow(/UNAUDITED/);
});
it("provider gate reserves once per HTTP attempt and stops before sending over budget", async () => {
  const budget = new Budget(2, 1, 0.1);
  let sends = 0;
  const gate = createRequestGate(budget, async () => {
    sends++;
    return new Response("ok");
  });
  await gate.fetch("https://chatgpt.com/backend-api/codex/responses");
  gate.record({
    requests: 1,
    inputTokens: 3,
    outputTokens: 1,
    costUsd: 0.01,
    latencyMs: 1,
    models: ["openai-codex/gpt-5.6-luna"],
  });
  await gate.fetch("https://chatgpt.com/backend-api/codex/responses");
  gate.record({
    requests: 1,
    inputTokens: 3,
    outputTokens: 1,
    costUsd: 0.01,
    latencyMs: 1,
    models: ["openai-codex/gpt-5.6-luna"],
  });
  await expect(
    gate.fetch("https://chatgpt.com/backend-api/codex/responses"),
  ).rejects.toThrow(/BUDGET/);
  expect(sends).toBe(2);
  expect(budget.requests).toBe(2);
});
it("unknown usage and external URLs fail closed before another provider request", async () => {
  const budget = new Budget(5, 1, 0.1);
  const deniedGate = createRequestGate(budget, async () => new Response("ok"));
  await expect(deniedGate.fetch("https://example.com")).rejects.toThrow(
    /NETWORK/,
  );
  expect(budget.requests).toBe(0);
  const gate = createRequestGate(budget, async () => new Response("ok"));
  await gate.fetch("https://chatgpt.com/backend-api/codex/responses");
  expect(() =>
    gate.record({
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      latencyMs: 0,
      models: [],
    }),
  ).toThrow(/USAGE/);
  await expect(
    gate.fetch("https://chatgpt.com/backend-api/codex/responses"),
  ).rejects.toThrow(/USAGE/);
});
it("a sent request with no response usage cannot silently settle", async () => {
  const gate = createRequestGate(
    new Budget(5, 1, 0.1),
    async () => new Response("ok"),
  );
  await gate.fetch("https://chatgpt.com/backend-api/codex/responses");
  expect(() => gate.finish()).toThrow(/USAGE/);
});
const cleanup: NativeHostFixtureAdapter[] = [];
afterEach(async () => {
  for (const host of cleanup.splice(0)) await host.close();
});
it("disposable Host uses actual action implementation, denies path escapes and revocation", async () => {
  const host = await NativeHostFixtureAdapter.create(
    scenario({
      tools: ["files.read", "files.write", "memory.add", "memory.read"],
    }),
    1,
  );
  cleanup.push(host);
  expect(
    JSON.stringify(
      await host.call({
        requestId: "r",
        action: "files.read",
        input: { projectId: "p1", args: { path: "note.txt" } },
      }),
    ),
  ).toContain("fixture");
  await expect(
    host.call({
      requestId: "e",
      action: "files.write",
      input: {
        projectId: "p1",
        args: { path: "../outside", content: "escape" },
      },
    }),
  ).rejects.toThrow(/PATH/);
  expect(host.trace.at(-1)).toMatchObject({
    call: { requestId: "e" },
    effect: false,
    result: { error: { code: "PATH_ESCAPE" } },
  });
  await expect(
    host.call({
      requestId: "x",
      action: "workspace.run",
      input: { command: "bash" },
    }),
  ).rejects.toThrow(/UNAUDITED/);
  host.revoke();
  await expect(
    host.call({
      requestId: "m",
      action: "memory.add",
      input: { fact: "escape" },
    }),
  ).rejects.toThrow(/revoked/);
});
it("freezes native sampling before runs and explicitly blocks unsupported fixture semantics", () => {
  const cases = [
    "memory",
    "recovery",
    "files",
    "permissions",
    "degradation",
    "structured",
  ].flatMap((category) =>
    ["a", "b"].map((suffix) =>
      scenario({ id: `${category}-${suffix}`, category, tools: [] }),
    ),
  );
  const manifest = freezeNativeManifest(cases, 42);
  expect(manifest.cases).toHaveLength(12);
  expect(manifest.cases.map((c) => c.id)).toEqual(
    freezeNativeManifest([...cases].reverse(), 42).cases.map((c) => c.id),
  );
  expect(
    freezeNativeManifest(
      [
        scenario({
          fixture: { sheets: { s: [[1]] } },
          tools: ["fixture.sheet.read"],
        }),
      ],
      1,
    ).status,
  ).toBe("blocked");
});
it("Host mutation replay records only the first mutation as an effect", async () => {
  const host = await NativeHostFixtureAdapter.create(
    scenario({ tools: ["memory.add"] }),
    1,
  );
  cleanup.push(host);
  const call = {
    requestId: "stable",
    action: "memory.add",
    input: { fact: "User prefers Helix." },
  };
  await host.call(call);
  await host.call(call);
  expect(host.trace.map((t) => t.effect)).toEqual([true, false]);
});
it("Host support rejects memory dates and document selectors instead of dropping their meaning", () => {
  for (const entry of [
    { fact: "fixture", date: "2026-10-09" },
    { fact: "fixture", file: "archive" },
  ]) {
    expect(
      NativeHostFixtureAdapter.support(
        scenario({ tools: ["memory.search"], fixture: { memory: [entry] } }),
      ).supported,
    ).toBe(false);
  }
});
