import {
  USAGE_CONTRACT_VERSION,
  type UsageSummary,
} from "../../../integrations/harness/core/usage";
/** Source IDs include filesystem identity, or the Cursor billing account identity. */
export function mergeUsageSummaries(summaries: readonly UsageSummary[]) {
  const seen = new Set<string>(),
    buckets: UsageSummary["buckets"] = [],
    sources: UsageSummary["sources"] = [];
  let duplicateSources = 0,
    sessions = 0;
  const providerSessions: NonNullable<UsageSummary["providerSessions"]> = {};
  for (const summary of summaries) {
    if (summary.contractVersion !== USAGE_CONTRACT_VERSION) continue;
    const accepted = new Set<string>();
    for (const source of summary.sources) {
      if (seen.has(source.id)) {
        duplicateSources++;
        continue;
      }
      seen.add(source.id);
      accepted.add(source.id);
      sources.push(source);
      sessions += source.distinctSessions ?? 0;
      providerSessions[source.provider] =
        (providerSessions[source.provider] ?? 0) +
        (source.distinctSessions ?? 0);
    }
    buckets.push(
      ...summary.buckets.filter(
        (bucket) => !bucket.sourceId || accepted.has(bucket.sourceId),
      ),
    );
    if (
      !summary.sources.some((source) => source.distinctSessions !== undefined)
    ) {
      sessions += summary.sessions;
      for (const [provider, count] of Object.entries(
        summary.providerSessions ?? {},
      ))
        providerSessions[provider as keyof typeof providerSessions] =
          (providerSessions[provider as keyof typeof providerSessions] ?? 0) +
          count;
    }
  }
  return { buckets, sources, sessions, providerSessions, duplicateSources };
}
