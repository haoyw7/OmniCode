/** A client-observed streaming sample, never provider billing/accounting. */
export type GenerationSample = {
  outputTokens: number;
  durationMs: number;
  tokenSource: "provider" | "text-estimate";
  method: "stream-estimate";
  scope: "last-text-segment";
  estimator?: "text-heuristic-v1";
};

export function sanitizeGenerationSample(
  value: unknown,
): GenerationSample | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.outputTokens !== "number" ||
    !Number.isSafeInteger(rec.outputTokens) ||
    rec.outputTokens < 0 ||
    typeof rec.durationMs !== "number" ||
    !Number.isFinite(rec.durationMs) ||
    rec.durationMs < 100 ||
    rec.method !== "stream-estimate" ||
    rec.scope !== "last-text-segment" ||
    (rec.tokenSource !== "provider" && rec.tokenSource !== "text-estimate") ||
    (rec.tokenSource === "text-estimate" &&
      rec.estimator !== "text-heuristic-v1")
  )
    return null;
  return {
    outputTokens: rec.outputTokens,
    durationMs: rec.durationMs,
    tokenSource: rec.tokenSource,
    method: rec.method,
    scope: rec.scope,
    ...(rec.tokenSource === "text-estimate"
      ? { estimator: "text-heuristic-v1" as const }
      : {}),
  };
}

export function formatGenerationRate(
  sample: GenerationSample,
  locale?: string,
): string {
  const rate = sample.outputTokens / (sample.durationMs / 1000);
  if (rate > 0 && rate < 0.01)
    return `<${new Intl.NumberFormat(locale).format(0.01)}`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    rate,
  );
}
