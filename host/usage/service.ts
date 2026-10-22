import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  USAGE_CONTRACT_VERSION,
  type UsagePriceOverrides,
  type UsageSummary,
  type UsageScanProgress,
} from "../../src/integrations/harness/core/usage";
import { aggregateUsage, validateUsageInput } from "./aggregation";
import { atomicUsageJson, UsagePricing } from "./pricing";
import { UsageReaders, usageReaders } from "./readers";
import { UsageLimits } from "./limits";
import { mergeAntigravityUsage } from "../../src/integrations/harness/providers/antigravity/antigravityUsage";

const priceSchema = z
  .object({
    inputCostPerMillionTokens: z.number().finite().nonnegative().max(1_000_000),
    outputCostPerMillionTokens: z
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000),
    cacheReadCostPerMillionTokens: z
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000)
      .optional(),
    cacheWriteCostPerMillionTokens: z
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000)
      .optional(),
  })
  .strict();
const settingsSchema = z.object({
  priceOverrides: z.record(z.string().trim().min(1).max(200), priceSchema),
  modelMappings: z
    .record(
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200),
    )
    .default({}),
  cursorKeychainEnabled: z.boolean().default(false),
});
export class HostUsageService {
  private readers: UsageReaders;
  private pricing: UsagePricing;
  private limits: UsageLimits;
  private queue: Promise<unknown> = Promise.resolve();
  private progress: UsageScanProgress = { pending: false, providers: [] };
  readProgress() {
    return this.progress;
  }
  constructor(
    private readonly directory: string,
    private readonly owner: string,
  ) {
    this.readers = new UsageReaders(join(directory, "transcripts"));
    this.pricing = new UsagePricing(directory);
    this.limits = new UsageLimits(owner);
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.queue.then(operation);
    this.queue = promise.catch(() => undefined);
    return promise;
  }
  private async settings() {
    try {
      return settingsSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "settings.json"), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          priceOverrides: {} as UsagePriceOverrides,
          modelMappings: {} as Record<string, string>,
          cursorKeychainEnabled: false,
        };
      throw new Error("Usage settings could not be read.");
    }
  }
  read(raw: Record<string, unknown>): Promise<UsageSummary> {
    const input = validateUsageInput(raw);
    return this.exclusive(async () => {
      this.progress = { pending: true, providers: [] };
      try {
        const started = Date.now(),
          settings = await this.settings();
        const pricing = await this.pricing.read();
        // Include all timezone offsets around the requested calendar days; exact bucketing
        // follows Intl's IANA timezone rules, including DST changes, in aggregation.
        const start = Math.max(
          0,
          Date.parse(`${input.sinceDay}T00:00:00Z`) - 86400_000,
        );
        const end = Math.min(
          Date.now(),
          Date.parse(`${input.untilDay}T00:00:00Z`) + 2 * 86400_000,
        );
        const scans = [];
        const seenFiles = new Set<string>();
        for (const reader of await usageReaders(this.owner)) {
          this.progress = { pending: true, providers: [reader.provider] };
          scans.push(
            await this.readers.scan(
              reader,
              start,
              end,
              settings.cursorKeychainEnabled,
              !!input.refresh,
              seenFiles,
            ),
          );
        }
        const records = scans.flatMap((scan) =>
          scan.records.map((record) => ({
            ...record,
            sourceId: scan.source.id,
          })),
        );
        const mergedRecords = [
          ...records.filter((record) => record.provider !== "antigravity"),
          ...mergeAntigravityUsage(
            records.filter((record) => record.provider === "antigravity"),
          ),
        ];
        const { sourceSessions, ...result } = aggregateUsage(
          mergedRecords,
          input,
          pricing.table,
          settings.priceOverrides,
          settings.modelMappings,
        );
        return {
          contractVersion: USAGE_CONTRACT_VERSION,
          readAt: Date.now(),
          ...input,
          ...result,
          sources: scans.map((scan) => ({
            ...scan.source,
            distinctSessions: sourceSessions[scan.source.id] ?? 0,
          })),
          pricing: pricing.info,
          priceOverrides: settings.priceOverrides,
          modelMappings: settings.modelMappings,
          cursorKeychainEnabled: settings.cursorKeychainEnabled,
          scanDurationMs: Date.now() - started,
        };
      } finally {
        this.progress = { pending: false, providers: [] };
      }
    });
  }
  readLimits(raw: Record<string, unknown>) {
    if (raw.refresh !== undefined && typeof raw.refresh !== "boolean")
      throw new Error("Invalid usage refresh option");
    return this.exclusive(async () =>
      this.limits.read(
        raw.refresh === true,
        (await this.settings()).cursorKeychainEnabled,
      ),
    );
  }
  resetLimits(raw: Record<string, unknown>) {
    return this.exclusive(() => this.limits.reset(raw));
  }
  update(raw: Record<string, unknown>) {
    const patch = z
      .object({
        cursorKeychainEnabled: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    return this.exclusive(async () => {
      const settings = await this.settings();
      if (patch.cursorKeychainEnabled !== undefined)
        settings.cursorKeychainEnabled = patch.cursorKeychainEnabled;
      await mkdir(this.directory, { recursive: true });
      await atomicUsageJson(join(this.directory, "settings.json"), settings);
      return settings;
    });
  }
}
