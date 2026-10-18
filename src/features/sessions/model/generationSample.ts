/** Sum of output tokens divided by the matching sum of LLM request durations. */
export type GenerationSample = {
  outputTokens: number;
  durationMs: number;
  tokenSource: "provider";
  method: "request-total";
  scope: "turn";
};

export function sanitizeGenerationSample(
  value: unknown,
): GenerationSample | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  // Old stream samples cannot be reconstructed as request totals from history.
  if (
    typeof rec.outputTokens !== "number" ||
    !Number.isSafeInteger(rec.outputTokens) ||
    rec.outputTokens < 0 ||
    typeof rec.durationMs !== "number" ||
    !Number.isFinite(rec.durationMs) ||
    rec.durationMs <= 0 ||
    rec.method !== "request-total" ||
    rec.scope !== "turn" ||
    rec.tokenSource !== "provider"
  )
    return null;
  return {
    outputTokens: rec.outputTokens,
    durationMs: rec.durationMs,
    tokenSource: "provider",
    method: "request-total",
    scope: "turn",
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
