import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HostUsageService } from "./service";
import { TranscriptUsageCache } from "./transcripts";
import { UsageDatabaseCache, scanUsageDatabase } from "./databases";
import { CursorUsageReader } from "./cursor";
import { usageReaders } from "./readers";
import { aggregateUsage, validateUsageInput } from "./aggregation";
import { createOverrideRateTable } from "../../src/integrations/harness/core/usagePricing";
import {
  initialCodexScanState,
  parseCodexRecord,
  type CodexScanState,
} from "../../src/integrations/harness/providers/codex/codexUsage";
import { parseClaudeRecord } from "../../src/integrations/harness/providers/claude/claudeUsage";
import { parsePiUsage } from "../../src/integrations/harness/providers/pi/piUsage";
import {
  EMPTY_TOTALS,
  type UsageRecord,
  type TranscriptUsageFormat,
} from "../../src/integrations/harness/core/usage";

const context = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => context.home,
}));
let directory = "";
const window = {
  sinceDay: "2026-10-01",
  untilDay: "2026-10-31",
  timeZone: "UTC",
};
const record = (patch: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: "claude",
  model: "example",
  sessionId: "session",
  timestampMs: Date.parse("2026-10-20T12:00:00Z"),
  totals: { ...EMPTY_TOTALS, uncachedInputTokens: 100, outputTokens: 20 },
  speed: "standard",
  reportedCostUsd: null,
  dedupeKey: null,
  ...patch,
});
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "omnicode-usage-"));
  context.home = join(directory, "home");
  await mkdir(context.home);
  for (const key of [
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
    "XDG_DATA_HOME",
    "OPENCODE_DATA_DIR",
    "ANTIGRAVITY_DATA_DIR",
    "CURSOR_AUTH_TOKEN",
    "CURSOR_API_KEY",
    "OMP_PROFILE",
    "PI_PROFILE",
    "PI_CONFIG_DIR",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("AGENT_CLI_CREDENTIAL_STORE", "memory");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            example: {
              input_cost_per_token: 0.01,
              output_cost_per_token: 0.02,
            },
          }),
        ),
    ),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("historical usage", () => {
  it("deduplicates Claude blocks, keeps exclusive cache inputs, and excludes placeholders", () => {
    const value = {
      type: "assistant",
      timestamp: "2026-10-20T12:00:00Z",
      sessionId: "s",
      requestId: "r",
      message: {
        id: "m",
        model: "example",
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
          output_tokens: 10,
        },
      },
    };
    const first = parseClaudeRecord(value)!;
    expect(first.totals).toEqual({
      uncachedInputTokens: 2,
      cachedInputTokens: 30,
      cacheCreationTokens: 4,
      outputTokens: 10,
      reasoningTokens: 0,
    });
    expect(
      aggregateUsage([first, first], window, new Map(), {}).buckets[0].records,
    ).toBe(1);
    expect(
      parseClaudeRecord({
        ...value,
        message: { ...value.message, model: "<synthetic>" },
      }),
    ).toBeNull();
  });
  it.each(["pi", "omp"] as const)(
    "counts %s assistant, tools, usage and summaries with stable fork identity",
    (provider) => {
      const state = { sessionId: "s" },
        usage = {
          input: 10,
          output: 5,
          cacheRead: 4,
          cacheWrite: 2,
          cost: { total: 0 },
        };
      const entry = {
        id: "1234abcd",
        timestamp: "2026-10-20T12:00:00Z",
        type: "message",
        message: {
          role: "assistant",
          provider: "openai",
          model: "old",
          responseModel: "example",
          usage,
        },
      };
      const parsed = parsePiUsage(entry, state, provider)[0];
      expect(parsed).toMatchObject({
        provider,
        model: "openai/example",
        reportedCostUsd: null,
      });
      expect(
        parsePiUsage(entry, { sessionId: "fork" }, provider)[0].dedupeKey,
      ).toBe(parsed.dedupeKey);
      for (const type of ["compaction", "branch_summary", "usage", "message"]) {
        const item =
          type === "message"
            ? { ...entry, message: { role: "toolResult", usage } }
            : { ...entry, type, usage };
        expect(parsePiUsage(item, state, provider)[0].model).toBe(
          "Tools/summaries",
        );
      }
    },
  );
  it("persists Codex context across incremental reads and ignores a partial UTF-8 final line", async () => {
    const path = join(directory, "session.jsonl"),
      cacheDir = join(directory, "cache");
    const format: TranscriptUsageFormat<CodexScanState> = {
      initial: initialCodexScanState,
      usageMarkers: ['"token_count"', '"session_meta"', '"turn_context"'],
      parse: (value, state) => {
        const result = parseCodexRecord(value, state);
        return result ? [result] : [];
      },
      malformed: (state) => state.malformedRecords,
    };
    const token = (input: number, total: number) => ({
      type: "event_msg",
      timestamp: "2026-10-20T12:00:00Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: input, output_tokens: 5 },
          total_token_usage: { input_tokens: total, output_tokens: total / 2 },
        },
      },
    });
    const tail = Buffer.from(line({ ...token(10, 20), note: "模型" }));
    await writeFile(
      path,
      line({ type: "session_meta", payload: { id: "s" } }) +
        line({ type: "turn_context", payload: { model: "example" } }) +
        line(token(10, 10)),
    );
    const cache = new TranscriptUsageCache(cacheDir);
    expect(
      (await cache.read(path, format as TranscriptUsageFormat)).records,
    ).toHaveLength(1);
    await appendFile(path, tail.subarray(0, tail.length - 4));
    expect(
      (await cache.read(path, format as TranscriptUsageFormat)).records,
    ).toHaveLength(1);
    await appendFile(path, tail.subarray(tail.length - 4));
    const resumed = await new TranscriptUsageCache(cacheDir).read(
      path,
      format as TranscriptUsageFormat,
    );
    expect(resumed.records).toHaveLength(2);
    expect(resumed.records[1].model).toBe("example");
    expect(resumed.malformed).toBe(0);
    await writeFile(
      path,
      line({ type: "turn_context", payload: { model: "replacement" } }) +
        line(token(10, 10)),
    );
    expect(
      (await cache.read(path, format as TranscriptUsageFormat)).records.map(
        (item) => item.model,
      ),
    ).toEqual(["replacement"]);
  });
  it("honors timezone/DST boundaries, does not add reasoning twice, and marks unknown prices", () => {
    const input = {
      sinceDay: "2026-11-01",
      untilDay: "2026-11-01",
      timeZone: "America/Los_Angeles",
    };
    const result = aggregateUsage(
      [
        record({ timestampMs: Date.parse("2026-11-01T06:59:59Z") }),
        record({
          timestampMs: Date.parse("2026-11-01T07:00:00Z"),
          totals: { ...EMPTY_TOTALS, outputTokens: 10, reasoningTokens: 8 },
        }),
        record({
          timestampMs: Date.parse("2026-11-02T07:59:59Z"),
          sessionId: "s2",
        }),
        record({ timestampMs: Date.parse("2026-11-02T08:00:00Z") }),
      ],
      input,
      new Map(),
      {},
    );
    expect(result.buckets[0]).toMatchObject({
      records: 2,
      unpricedRecords: 2,
      costUsd: 0,
      totals: { outputTokens: 30, reasoningTokens: 8 },
    });
    expect(result.sessions).toBe(2);
    for (const raw of [
      { ...window, sinceDay: "2026-02-30" },
      { ...window, timeZone: "nonsense" },
      { ...window, sinceDay: "2024-01-01" },
    ])
      expect(() => validateUsageInput(raw)).toThrow();
  });
  it("reads OpenCode SQLite plus legacy JSON without double billing and notices WAL changes", async () => {
    const path = join(directory, "opencode.db"),
      db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER)",
    );
    const value = {
      role: "assistant",
      modelID: "example",
      tokens: {
        input: 10,
        cache: { read: 5, write: 3 },
        output: 6,
        reasoning: 2,
      },
      cost: 0,
    };
    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    insert.run("m1", "s", JSON.stringify(value), Date.parse("2026-10-20"));
    const cache = new UsageDatabaseCache();
    const first = await cache.read(path, "opencode");
    expect(first[0]).toMatchObject({
      reportedCostUsd: null,
      totals: {
        uncachedInputTokens: 10,
        cachedInputTokens: 5,
        cacheCreationTokens: 3,
        outputTokens: 8,
        reasoningTokens: 2,
      },
    });
    insert.run("m2", "s", JSON.stringify(value), Date.parse("2026-10-20"));
    expect(await cache.read(path, "opencode")).toHaveLength(2);
    db.close();
    await mkdir(join(directory, "storage/message/s"), { recursive: true });
    await writeFile(
      join(directory, "storage/message/s/m1.json"),
      JSON.stringify({
        ...value,
        id: "m1",
        sessionID: "s",
        time: { created: Date.parse("2026-10-20") },
      }),
    );
    const scan = await scanUsageDatabase(directory, "opencode", cache);
    expect(
      aggregateUsage(scan.records, window, new Map(), {}).buckets[0].records,
    ).toBe(2);
  });
  it("preserves saved prices when updating usage settings and never includes conversation text", async () => {
    const home = join(context.home, ".claude/projects/project");
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "s.jsonl"),
      line({
        type: "assistant",
        timestamp: "2026-10-20T12:00:00Z",
        message: {
          id: "m",
          model: "example",
          content: [{ text: "private-conversation-body" }],
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      }),
    );
    const serviceDir = join(directory, "usage"),
      owner = join(directory, "desktop-owner.json"),
      service = new HostUsageService(serviceDir, owner);
    const result = await service.read(window);
    expect(result.buckets[0].costUsd).toBeCloseTo(1.2);
    const savedPrices = {
      priceOverrides: {
        example: {
          inputCostPerMillionTokens: 2,
          outputCostPerMillionTokens: 4,
        },
      },
      modelMappings: { alias: "example" },
    };
    await writeFile(
      join(serviceDir, "settings.json"),
      JSON.stringify(savedPrices),
    );
    await service.update({ cursorKeychainEnabled: true });
    const reloaded = await new HostUsageService(serviceDir, owner).read(window);
    expect(reloaded.buckets[0].costUsd).toBeCloseTo(0.00024);
    expect(JSON.stringify(reloaded)).not.toContain("private-conversation-body");
    const settings = await readFile(join(serviceDir, "settings.json"), "utf8");
    expect(JSON.parse(settings)).toEqual({
      ...savedPrices,
      cursorKeychainEnabled: true,
    });
    expect(() =>
      service.update({
        model: "example",
        price: { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
      }),
    ).toThrow();
    expect(() => service.update({ model: "example", price: null })).toThrow();
    expect(() =>
      service.update({ model: "alias", mapTo: "example" }),
    ).toThrow();
    expect((await service.read(window)).priceOverrides).toEqual(
      savedPrices.priceOverrides,
    );
  });
  it("finds configured histories without counting the same canonical root twice", async () => {
    const custom = join(context.home, ".claude");
    await mkdir(custom, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", custom);
    const accountDir = join(directory, "provider-accounts");
    await mkdir(accountDir);
    await writeFile(
      join(accountDir, "state.json"),
      JSON.stringify({
        accounts: { claude: [{ id: "work", label: "Work", dataHome: custom }] },
        defaults: {},
      }),
    );
    const readers = await usageReaders(join(directory, "desktop-owner.json"));
    expect(
      readers.filter((reader) => reader.provider === "claude"),
    ).toHaveLength(1);
    expect(readers.some((reader) => reader.provider === "omp")).toBe(true);
  });
  it("merges Antigravity protobuf request identities transitively and takes component maxima", async () => {
    const number = (field: number, value: number) => {
      const bytes = [field * 8];
      do {
        const byte = value % 128;
        value = Math.floor(value / 128);
        bytes.push(byte + (value ? 128 : 0));
      } while (value);
      return bytes;
    };
    const bytes = (field: number, value: number[]) => [
      ...number(field, value.length).map((value, index) =>
        index === 0 ? value + 2 : value,
      ),
      ...value,
    ];
    const text = (field: number, value: string) =>
      bytes(field, [...Buffer.from(value)]);
    const usage = (
      input: number,
      cache: number,
      output: number,
      ids: number[],
    ) => [
      ...number(1, 281),
      ...number(2, input),
      ...number(5, cache),
      ...number(3, output),
      ...number(9, 2),
      ...number(10, 3),
      ...ids,
    ];
    const path = join(directory, "antigravity.db"),
      db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB)",
    );
    db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
      1,
      Buffer.from(
        bytes(
          1,
          bytes(4, usage(10, 3, 4, [...text(11, "a"), ...text(12, "b")])),
        ),
      ),
    );
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(
      1,
      Buffer.from(
        bytes(9, usage(20, 2, 8, [...text(12, "b"), ...text(7, "c")])),
      ),
    );
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(
      2,
      Buffer.from(bytes(9, usage(5, 9, 6, [...text(7, "c")]))),
    );
    db.close();
    const records = await new UsageDatabaseCache().read(path, "antigravity");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      model: "claude-sonnet-4",
      totals: {
        uncachedInputTokens: 20,
        cachedInputTokens: 9,
        outputTokens: 8,
        reasoningTokens: 2,
      },
    });
  });
  it("preserves identical Cursor billed rows and reconciles an overlapping 1000-row page", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ sub: "auth|account" })).toString("base64url")}.signature`;
    vi.stubEnv("CURSOR_AUTH_TOKEN", token);
    const event = {
      timestamp: Date.parse("2026-10-20"),
      model: "cursor-grok-4-high-fast",
      tokenUsage: {
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 3,
        totalCents: 4,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const page = JSON.parse(init.body).page;
        return new Response(
          JSON.stringify({
            totalUsageEventsCount: 1001,
            usageEventsDisplay:
              page === 1
                ? Array.from({ length: 1000 }, () => event)
                : [event, event],
          }),
        );
      }),
    );
    const records = await new CursorUsageReader().read(
      Date.parse("2026-10-01"),
      Date.parse("2026-10-31"),
      false,
    );
    expect(records).toHaveLength(1001);
    expect(new Set(records.map((record) => record.dedupeKey)).size).toBe(1001);
    expect(records[0]).toMatchObject({
      rateModel: "xai/grok-4",
      reportedCostUsd: 0.04,
      totals: { uncachedInputTokens: 2, cachedInputTokens: 3 },
    });
  });
});

it("uses exact hourly boundaries and model mappings without overriding explicit prices", () => {
  const input = {
    ...window,
    resolution: "hour" as const,
    sinceTime: "2026-10-20T12:30:00Z",
    untilTime: "2026-10-20T14:30:00Z",
  };
  const data = [
    record({ timestampMs: Date.parse("2026-10-20T12:29:59Z") }),
    record({ timestampMs: Date.parse("2026-10-20T12:30:00Z") }),
    record({ timestampMs: Date.parse("2026-10-20T13:30:00Z") }),
    record({ timestampMs: Date.parse("2026-10-20T14:30:01Z") }),
  ];
  const table = createOverrideRateTable({
    target: { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 4 },
  });
  const mapped = aggregateUsage(data, input, table, {}, { example: "target" });
  expect(mapped.buckets.map((bucket) => bucket.hourStart)).toEqual([
    "2026-10-20T12:00:00.000Z",
    "2026-10-20T13:00:00.000Z",
  ]);
  expect(mapped.buckets[0]).toMatchObject({
    model: "example",
    records: 1,
    unpricedRecords: 0,
  });
  expect(mapped.buckets[0].costUsd).toBeCloseTo(0.00028);
  const own = aggregateUsage(
    data,
    input,
    table,
    {
      example: { inputCostPerMillionTokens: 5, outputCostPerMillionTokens: 10 },
    },
    { example: "target" },
  );
  expect(own.buckets[0].costUsd).toBeCloseTo(0.0007);
});

it("keeps Cursor limit identity stable across refreshed login tokens without exposing credentials", async () => {
  const { UsageLimits } = await import("./limits");
  const token = `header.${Buffer.from(JSON.stringify({ sub: "auth|same-account" })).toString("base64url")}.signature`;
  vi.stubEnv("CURSOR_AUTH_TOKEN", token);
  vi.stubEnv("CURSOR_API_ENDPOINT", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            planUsage: { autoPercentUsed: 25, apiPercentUsed: 50 },
            billingCycleEnd: Date.parse("2026-11-01"),
          }),
        ),
    ),
  );
  const service = new UsageLimits(join(directory, "desktop-owner.json"));
  const first = (await service.read(true, false)).find(
    (source) => source.provider === "cursor",
  )!;
  expect(first).toMatchObject({
    status: "ok",
    windows: [
      { id: "autoPercentUsed", usedPercent: 25 },
      { id: "apiPercentUsed", usedPercent: 50 },
    ],
  });
  expect(first.accountKey).toMatch(/^[a-f0-9]{64}$/);
  vi.stubEnv("CURSOR_AUTH_TOKEN", token.replace("signature", "refreshed"));
  const next = (await service.read(true, false)).find(
    (source) => source.provider === "cursor",
  )!;
  expect(next.accountKey).toBe(first.accountKey);
  expect(JSON.stringify(next)).not.toContain(token);
});
