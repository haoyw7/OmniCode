import { existsSync, renameSync, writeFileSync } from "node:fs";
import { Budget, type CompletionAdapter } from "./adapters";
import { EvalError, type Usage } from "./schema";

/** One owner, one in-flight provider request, persisted before inference.
 * A durable file is never reopened as a fresh budget; crash recovery is manual.
 */
export class CampaignBudget extends Budget {
  private pending = false;
  private blockedReason: string | null = null;
  private completions: Usage[] = [];
  constructor(
    readonly path: string,
    maxRequests = 200,
    maxUsd = 2,
    requestUsd = 0.01,
    readonly reservationMode: "nominal" | "catalog-upper-bound" = "nominal",
  ) {
    super(maxRequests, maxUsd, requestUsd);
    if (existsSync(path)) throw Error("Campaign budget already exists");
    writeFileSync(path, JSON.stringify(this.snapshot(), null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  override reserve() {
    if (this.blockedReason) throw new EvalError("USAGE_UNKNOWN");
    if (this.pending) throw new EvalError("UNSETTLED_REQUEST");
    super.reserve();
    this.pending = true;
    this.persist();
  }
  recordUsage(usage: Usage) {
    if (!this.pending) throw new EvalError("NO_RESERVED_REQUEST");
    this.completions.push(structuredClone(usage));
    this.pending = false;
    if (
      usage.requests !== 1 ||
      usage.costUsd === null ||
      !Number.isFinite(usage.costUsd) ||
      usage.costUsd < 0
    )
      this.blockedReason = "USAGE_UNKNOWN";
    // Existing PiAdapter updates actualUsd itself; derive the sum to avoid double-counting.
    this.actualUsd = this.completions.reduce(
      (sum, u) =>
        sum +
        (typeof u.costUsd === "number" &&
        Number.isFinite(u.costUsd) &&
        u.costUsd >= 0
          ? u.costUsd
          : 0),
      0,
    );
    if (this.reservationMode === "catalog-upper-bound" && !this.blockedReason) {
      if (usage.costUsd! > this.requestUsd + 1e-9)
        this.blockedReason = "COST_BOUND_EXCEEDED";
      this.reservedUsd = this.actualUsd;
    }
    this.persist();
  }
  failClosed(reason: string) {
    this.pending = false;
    this.blockedReason = reason;
    this.persist();
  }
  snapshot() {
    return {
      version: "campaign-budget-v2",
      maxRequests: this.maxRequests,
      maxUsd: this.maxUsd,
      reservationPerRequestUsd: this.requestUsd,
      requests: this.requests,
      reservedUsd: this.reservedUsd,
      reportedUsd: this.blockedReason ? null : this.actualUsd,
      knownReportedUsd: this.actualUsd,
      unsettledRequest: this.pending,
      blockedReason: this.blockedReason,
      completionCount: this.completions.length,
      providerCap: false,
      reservationMode: this.reservationMode,
      note:
        this.reservationMode === "catalog-upper-bound"
          ? "Before each HTTP request reserve the declared model full-context worst tariff bound; release unused reservation only after known usage. Bound assumes catalog capacity and tariff remain correct. Unknown usage holds reservation and stops all calls; this is not a provider billing setting."
          : "Nominal USD reservation is not a provider billing cap; unknown usage stops the campaign.",
    };
  }
  private persist() {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.snapshot(), null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(temporary, this.path);
  }
}

/** The underlying adapter must use this same budget and reserve exactly once. */
export function accountCompletions(
  adapter: CompletionAdapter,
  budget: CampaignBudget,
): CompletionAdapter {
  return {
    model: adapter.model,
    async complete(system, input) {
      const before = budget.requests;
      try {
        const response = await adapter.complete(system, input);
        budget.recordUsage(response.usage);
        return response;
      } catch (error) {
        if (budget.requests > before) {
          if (error && typeof error === "object" && "usage" in error)
            budget.recordUsage((error as { usage: Usage }).usage);
          else
            budget.failClosed(
              error instanceof Error ? error.message : "PROVIDER_ERROR",
            );
        }
        throw error;
      }
    },
  };
}
