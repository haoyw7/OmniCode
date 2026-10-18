import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ProviderDiagnosticJournal } from "../src/providerJournal";
import { CampaignBudget } from "../src/campaignBudget";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Budget } from "../src/adapters";
import { CaseSchema } from "../src/schema";
import {
  loadInstalledPiSdk,
  NativePiFixtureAdapter,
  NativePiCompletionAdapter,
  conservativeModelRequestBound,
} from "../src/nativePiFixtureAdapter";
const fixture = CaseSchema.parse({
  id: "native-sdk",
  category: "files",
  language: "en",
  support: "native",
  tier: "standard",
  prompt: "Read note.txt",
  tools: ["files.read"],
  fixture: { files: { "note.txt": "offline-fixture" } },
  assertions: [{ kind: "no_effects" }],
  rubric: ["safety"],
  provenance: { kind: "original", source: "sdk-test" },
});
async function offlineRuntime(
  finalText = "offline-fixture",
  toolFirst = true,
  terminal?: { stopReason: "error" | "aborted"; errorMessage: string },
  amendMessage?: (message: any) => void,
  wireUsage: "present" | "absent" = "present",
  amendProviderEvent?: (event: any) => void,
) {
  const root = resolve(
    dirname(process.execPath),
    "../lib/node_modules/@earendil-works/pi-coding-agent",
  );
  const sdk = await loadInstalledPiSdk(root);
  const ai = await import(
    /* @vite-ignore */ pathToFileURL(
      join(root, "node_modules/@earendil-works/pi-ai/dist/index.js"),
    ).href
  );
  const models = await import(
    /* @vite-ignore */ pathToFileURL(
      join(
        root,
        "node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.models.js",
      ),
    ).href
  );
  const model = models.OPENAI_CODEX_MODELS["gpt-5.6-luna"];
  let turns = 0;
  const requests: any[] = [];
  const runtime = {
    getModel: () => model,
    getPhysicalModel: () => model,
    hasConfiguredAuth: () => true,
    isUsingOAuth: () => false,
    getAuth: async () => ({ apiKey: "offline-test-only" }),
    getAvailableSnapshot: () => [model],
    getRegisteredProviderIds: () => [],
    getRegisteredProviderConfig: () => undefined,
    streamSimple(m: any, context: any, options: any) {
      requests.push({
        tools: ai.getCurrentTools(context.messages).map((t: any) => t.name),
        transport: options.transport,
        maxRetries: options.maxRetries,
      });
      const stream = ai.createAssistantMessageEventStream();
      void (async () => {
        try {
          await options.fetch(
            "https://chatgpt.com/backend-api/codex/responses",
          );
          const turn = ++turns;
          const message = {
            role: "assistant",
            provider: m.provider,
            model: m.id,
            api: m.api,
            timestamp: Date.now(),
            content:
              toolFirst && turn === 1
                ? [
                    {
                      type: "toolCall",
                      id: "call-1",
                      name: "files__read",
                      arguments: {
                        requestId: "read",
                        input: { projectId: "p1", args: { path: "note.txt" } },
                      },
                    },
                  ]
                : [{ type: "text", text: finalText }],
            stopReason: toolFirst && turn === 1 ? "toolUse" : "stop",
            usage: {
              input: 10,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 0.001 },
            },
          };
          if (terminal) Object.assign(message, terminal);
          amendMessage?.(message);
          const providerEvent = {
            type: "response.completed",
            response: {
              status: "completed",
              ...(wireUsage === "present"
                ? {
                    usage: {
                      input_tokens:
                        message.usage.input +
                        message.usage.cacheRead +
                        message.usage.cacheWrite,
                      output_tokens: message.usage.output,
                      input_tokens_details: {
                        cached_tokens: message.usage.cacheRead,
                        cache_write_tokens: message.usage.cacheWrite,
                      },
                    },
                  }
                : {}),
            },
          };
          amendProviderEvent?.(providerEvent);
          await options.onProviderStreamEvent?.(providerEvent, m);
          if (turn > 1) {
            stream.push({ type: "start", partial: message });
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta: finalText,
              partial: message,
            });
          }
          if (terminal)
            stream.push({
              type: "error",
              reason: terminal.stopReason,
              error: message,
            });
          else
            stream.push({ type: "done", reason: message.stopReason, message });
        } catch (cause) {
          stream.push({
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              provider: m.provider,
              model: m.id,
              api: m.api,
              timestamp: Date.now(),
              content: [],
              stopReason: "error",
              errorMessage: String(cause),
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: { total: 0 },
              },
            },
          });
        }
      })();
      return stream;
    },
  };
  return { sdk, runtime, requests };
}
it("installed Pi SDK executes registered fixture tool loop without builtins, discovery or authentication", async () => {
  const { sdk, runtime, requests } = await offlineRuntime();
  const budget = new Budget(4, 1, 0.1);
  const adapter = new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget,
    fetch: async () => new Response("offline"),
  });
  const result = await adapter.run(fixture, 7);
  expect(result.status, result.error).toBe("completed");
  expect(result.trace).toHaveLength(1);
  expect(result.trace[0].result).toMatchObject({ text: "offline-fixture" });
  expect(result.final).toBe("offline-fixture");
  expect(budget.requests).toBe(2);
  expect(result.requestUsage).toHaveLength(2);
  expect(requests).toEqual([
    { tools: ["files__read"], transport: "sse", maxRetries: 0 },
    { tools: ["files__read"], transport: "sse", maxRetries: 0 },
  ]);
});
it("installed Pi loop cannot send its continuation when the shared request budget is exhausted", async () => {
  const { sdk, runtime } = await offlineRuntime();
  let sends = 0;
  const result = await new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget: new Budget(1, 1, 0.1),
    fetch: async () => {
      sends++;
      return new Response("offline");
    },
  }).run(fixture, 7);
  expect(result.status).toBe("failed");
  expect(result.error).toMatch(/BUDGET/);
  expect(sends).toBe(1);
});
it("installed SDK preflight verifies loadout and disposes its session without sending or reserving", async () => {
  const { sdk, runtime, requests } = await offlineRuntime();
  const budget = new Budget(1, 1, 0.1);
  const result = await new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget,
  }).preflight(fixture);
  expect(result).toMatchObject({
    model: "openai-codex/gpt-5.6-luna",
    thinking: "low",
    tools: ["files__read"],
  });
  expect(budget.requests).toBe(0);
  expect(requests).toHaveLength(0);
});
it("aborts excessive streamed output without returning the oversized final", async () => {
  const { sdk, runtime } = await offlineRuntime("X".repeat(50000));
  const result = await new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget: new Budget(4, 1, 0.1),
    fetch: async () => new Response("offline"),
    maxOutputBytes: 1000,
  }).run(fixture, 7);
  expect(result.status).toBe("failed");
  expect(result.error).toMatch(/OUTPUT_BYTE_LIMIT/);
  expect(Buffer.byteLength(result.final)).toBeLessThanOrEqual(1000);
});
it("SDK text completion sends exact caller prompts, no tools, and accounts two sequential requests", async () => {
  const { sdk, runtime, requests } = await offlineRuntime("text-only", false);
  const contexts: any[] = [];
  const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (m, context, options) => {
    contexts.push(structuredClone(context));
    return stream(m, context, options);
  };
  const budget = new Budget(2, 1, 0.1);
  const settled: any[] = [];
  const bounds: any[] = [];
  const completion = new NativePiCompletionAdapter({
    sdk,
    modelRuntime: runtime,
    budget,
    fetch: async () => new Response("offline"),
    onUsage: (usage) => settled.push(usage),
    onRequestBound: (bound) => bounds.push(bound),
    maxOutputBytes: 4096,
  });
  expect(
    await completion.complete("exact caller system", "exact caller input"),
  ).toMatchObject({ text: "text-only", usage: { requests: 1 } });
  expect(
    await completion.complete("second caller system", "second caller input"),
  ).toMatchObject({ text: "text-only", usage: { requests: 1 } });
  expect(requests.map((r) => r.tools)).toEqual([[], []]);
  expect(budget.requests).toBe(2);
  expect(settled).toHaveLength(2);
  expect(bounds.map((bound) => bound.conservativeUsd)).toEqual([
    0.6256, 0.6256,
  ]);
  expect(JSON.stringify(contexts[0])).toContain("exact caller system");
  expect(JSON.stringify(contexts[0])).toContain("exact caller input");
  expect(JSON.stringify(contexts[0])).not.toContain(
    "Use native registered tools",
  );
});
it("conservative catalog bound includes cache-write and maximum tiers and rejects missing finite capacities", () => {
  const model = {
    provider: "openai-codex",
    id: "gpt-5.6-luna",
    contextWindow: 272000,
    maxTokens: 128000,
    cost: {
      input: 0.2,
      output: 1.2,
      cacheRead: 0.02,
      cacheWrite: 0.25,
      tiers: [{ input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5 }],
    },
  };
  expect(conservativeModelRequestBound(model)).toMatchObject({
    conservativeUsd: 0.6256,
    maxInputUsdPerMillion: 0.5,
    maxOutputUsdPerMillion: 1.8,
  });
  expect(() =>
    conservativeModelRequestBound({ ...model, contextWindow: Infinity }),
  ).toThrow(/LIMIT/);
  expect(() =>
    conservativeModelRequestBound({
      ...model,
      cost: { ...model.cost, cacheWrite: NaN },
    }),
  ).toThrow(/PRICE/);
});
it("tool-free SDK completion rejects generated tool calls and never sends a continuation", async () => {
  const { sdk, runtime } = await offlineRuntime();
  let sent = 0;
  const completion = new NativePiCompletionAdapter({
    sdk,
    modelRuntime: runtime,
    budget: new Budget(4, 1, 0.1),
    fetch: async () => {
      sent++;
      return new Response("offline");
    },
  });
  await expect(
    completion.complete("neutral", "generate text only"),
  ).rejects.toThrow(/NATIVE_TOOL_VIOLATION/);
  expect(sent).toBe(1);
});
it.each([
  {
    status: 503,
    stopReason: "error" as const,
    failureKind: "PROVIDER_HTTP_ERROR",
  },
  {
    status: 200,
    stopReason: "aborted" as const,
    failureKind: "PROVIDER_ABORTED",
  },
])(
  "preserves sanitized $failureKind separately from unknown usage",
  async ({ status, stopReason, failureKind }) => {
    const { sdk, runtime } = await offlineRuntime("", false, {
      stopReason,
      errorMessage: "provider body has Bearer SECRET_DO_NOT_COPY",
    });
    const completion = new NativePiCompletionAdapter({
      sdk,
      modelRuntime: runtime,
      budget: new Budget(4, 1, 0.1),
      fetch: async () => new Response("SECRET_BODY_DO_NOT_COPY", { status }),
    });
    let caught: any;
    try {
      await completion.complete("neutral", "offline failure fixture");
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe("UNKNOWN_PROVIDER_USAGE");
    expect(caught.usage.costUsd).toBeNull();
    expect(caught.diagnostics).toMatchObject({
      httpStatus: status,
      stopReason,
      failureKind,
      usageFieldsPresent: true,
      usageAccepted: false,
    });
    expect(JSON.stringify(caught.diagnostics)).not.toContain("SECRET");
  },
);
it("retains normalized transport failure without retaining exception text", async () => {
  const { sdk, runtime } = await offlineRuntime("", false);
  const result = await new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget: new Budget(4, 1, 0.1),
    fetch: async () => {
      throw new Error("ECONNRESET Bearer SECRET_DO_NOT_COPY");
    },
  }).run(fixture, 7);
  expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
  expect(result.diagnostics).toMatchObject({
    httpStatus: null,
    stopReason: "error",
    failureKind: "NETWORK_ERROR",
    transportFailureKind: "NETWORK_ERROR",
  });
  expect(JSON.stringify(result.diagnostics)).not.toContain("SECRET");
});

it.each([
  { stopReason: "stop", state: "completed", status: 200 },
  { stopReason: "error", state: "failed", status: 503 },
  { stopReason: "aborted", state: "cancelled", status: 200 },
])(
  "persists $state request evidence after installed SDK temporary session cleanup",
  async ({ stopReason, state, status }) => {
    const dir = mkdtempSync(join(tmpdir(), "native-durable-diagnostics-"));
    try {
      const { sdk, runtime } = await offlineRuntime(
        "offline answer",
        false,
        stopReason === "stop"
          ? undefined
          : {
              stopReason: stopReason as "error" | "aborted",
              errorMessage: "SECRET_PROVIDER_PAYLOAD",
            },
      );
      let sessionDirectory = "";
      const original = sdk.createAgentSession;
      sdk.createAgentSession = async (opts: any) => {
        sessionDirectory = opts.cwd;
        return original(opts);
      };
      const path = join(dir, "provider-diagnostics.jsonl"),
        journal = new ProviderDiagnosticJournal(path);
      const budget = new CampaignBudget(
        join(dir, "budget.json"),
        200,
        2,
        0.6256,
        "catalog-upper-bound",
      );
      const result = await new NativePiFixtureAdapter({
        sdk,
        modelRuntime: runtime,
        budget,
        diagnosticJournal: journal,
        diagnosticContext: {
          caseId: "durable-case",
          phase: "native",
          arm: "control",
        },
        onUsage: (u) => budget.recordUsage(u),
        fetch: async () =>
          new Response("SECRET_BODY", {
            status,
            headers: { "x-request-id": "req_0123456789abcdef" },
          }),
      }).run({ ...fixture, tools: [] }, 7);
      expect(sessionDirectory).not.toBe("");
      expect(existsSync(sessionDirectory)).toBe(false);
      const text = readFileSync(path, "utf8"),
        records = text
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
      expect(records.at(-1)).toMatchObject({
        terminalState: state,
        httpStatus: status,
        providerRequestId: "req_0123456789abcdef",
        caseId: "durable-case",
        usageMissing: stopReason !== "stop",
      });
      expect(records.at(-1).localRequestId).toBe(
        result.diagnostics?.localRequestId,
      );
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("offline answer");
      expect(text).not.toContain("Read note.txt");
      expect(result.usage.costUsd).toBe(stopReason === "stop" ? 0.001 : null);
      if (stopReason !== "stop") {
        expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
        expect(() => budget.reserve()).toThrow("USAGE_UNKNOWN");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    name: "missing input usage",
    amend: (m: any) => {
      delete m.usage.input;
    },
  },
  {
    name: "negative input usage",
    amend: (m: any) => {
      m.usage.input = -1;
    },
  },
  {
    name: "negative cache usage",
    amend: (m: any) => {
      m.usage.cacheRead = -1;
    },
  },
  {
    name: "pending stop state",
    amend: (m: any) => {
      m.stopReason = "pending";
    },
  },
  {
    name: "unrecognized stop state",
    amend: (m: any) => {
      m.stopReason = "unexpected";
    },
  },
])(
  "rejects $name even when SDK cost.total looks numeric",
  async ({ amend }) => {
    const dir = mkdtempSync(join(tmpdir(), "native-unaccepted-usage-"));
    try {
      const { sdk, runtime } = await offlineRuntime(
        "offline answer",
        false,
        undefined,
        amend,
      );
      const budget = new CampaignBudget(
        join(dir, "budget.json"),
        200,
        2,
        0.6256,
        "catalog-upper-bound",
      );
      const result = await new NativePiFixtureAdapter({
        sdk,
        modelRuntime: runtime,
        budget,
        onUsage: (u) => budget.recordUsage(u),
        fetch: async () => new Response("offline"),
      }).run({ ...fixture, tools: [] }, 7);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
      expect(result.usage.costUsd).toBeNull();
      expect(result.diagnostics).toMatchObject({
        usageAccepted: false,
        usageMissing: true,
      });
      expect(budget.snapshot()).toMatchObject({
        requests: 1,
        reservedUsd: 0.6256,
        reportedUsd: null,
      });
      expect(() => budget.reserve()).toThrow("USAGE_UNKNOWN");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it.each(["absent", "present"] as const)(
  "distinguishes %s provider usage from SDK zero placeholders",
  async (wireUsage) => {
    const { sdk, runtime } = await offlineRuntime(
      "offline answer",
      false,
      undefined,
      (m) => {
        m.usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0 },
        };
      },
      wireUsage,
    );
    const result = await new NativePiFixtureAdapter({
      sdk,
      modelRuntime: runtime,
      budget: new Budget(4, 1, 0.1),
      fetch: async () => new Response("offline"),
    }).run({ ...fixture, tools: [] }, 7);
    expect(result.status).toBe(
      wireUsage === "present" ? "completed" : "failed",
    );
    expect(result.usage.costUsd).toBe(wireUsage === "present" ? 0 : null);
    expect(result.diagnostics?.usageAccepted).toBe(wireUsage === "present");
    if (wireUsage === "absent")
      expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
  },
);

it.each([
  {
    name: "missing provider status",
    amend: (e: any) => {
      delete e.response.status;
    },
  },
  {
    name: "queued provider status",
    amend: (e: any) => {
      e.response.status = "queued";
    },
  },
  {
    name: "unknown provider status",
    amend: (e: any) => {
      e.response.status = "future-status";
    },
  },
  {
    name: "empty provider usage",
    amend: (e: any) => {
      e.response.usage = {};
    },
  },
  {
    name: "null cached tokens",
    amend: (e: any) => {
      e.response.usage.input_tokens_details.cached_tokens = null;
    },
  },
])("does not trust SDK completion after $name", async ({ amend }) => {
  const { sdk, runtime } = await offlineRuntime(
    "offline answer",
    false,
    undefined,
    undefined,
    "present",
    amend,
  );
  const result = await new NativePiFixtureAdapter({
    sdk,
    modelRuntime: runtime,
    budget: new Budget(4, 1, 0.1),
    fetch: async () => new Response("offline"),
  }).run({ ...fixture, tools: [] }, 7);
  expect(result.error).toBe("UNKNOWN_PROVIDER_USAGE");
  expect(result.usage.costUsd).toBeNull();
  expect(result.diagnostics?.providerUsageObserved).toBe(false);
});
