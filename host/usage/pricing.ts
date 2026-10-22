import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseRateTable,
  type RateTable,
} from "../../src/integrations/harness/core/usagePricing";
import type { UsageSummary } from "../../src/integrations/harness/core/usage";
import { usageJson } from "./http";

export const PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export async function atomicUsageJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
export class UsagePricing {
  private data?: { table: RateTable; fetchedAt: number };
  private retryAt = 0;
  constructor(private readonly directory: string) {}
  async read(): Promise<{ table: RateTable; info: UsageSummary["pricing"] }> {
    const path = join(this.directory, "prices.json");
    if (!this.data)
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        const table = parseRateTable(cached.document);
        if (table.size && typeof cached.fetchedAt === "number")
          this.data = { table, fetchedAt: cached.fetchedAt };
      } catch {
        /* The public table remains optional offline. */
      }
    let status: UsageSummary["pricing"]["status"] = this.data
      ? "cached"
      : "unavailable";
    if (
      (!this.data || Date.now() - this.data.fetchedAt > 24 * 60 * 60_000) &&
      Date.now() >= this.retryAt
    ) {
      this.retryAt = Date.now() + 5 * 60_000;
      try {
        const document = await usageJson(PRICING_URL);
        const table = parseRateTable(document);
        if (!table.size) throw new Error("Invalid public price table");
        const fetchedAt = Date.now();
        this.data = { table, fetchedAt };
        status = "fresh";
        await mkdir(this.directory, { recursive: true });
        await atomicUsageJson(path, { document, fetchedAt });
      } catch {
        /* Keep the last successful table; never replace it with an error response. */
      }
    }
    return {
      table: this.data?.table ?? new Map(),
      info: {
        status,
        source: PRICING_URL,
        fetchedAt: this.data?.fetchedAt ?? null,
        knownModels: this.data?.table.size ?? 0,
      },
    };
  }
}
