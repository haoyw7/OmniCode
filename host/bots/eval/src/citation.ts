import type { Scenario, Trace } from "./schema";

export const LEGACY_SCORER_VERSION = "legacy-v1" as const;
export const SCORER_VERSION = "citation-v2" as const;
export type ScorerVersion =
  typeof LEGACY_SCORER_VERSION | typeof SCORER_VERSION;
export type CitationAssertion = Extract<
  Scenario["assertions"][number],
  { kind: "citation" }
>;
export type CitationClaim = { source: string; text: string };
export type CitationSource = { source: string; aliases: string[] };

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Match a literal quote without accepting a fragment of a numeric token. */
export function containsCitationEvidence(text: string, quote: string): boolean {
  if (!quote) return false;
  // Preserve grouping separators and signed exponents as one token. Space grouping
  // needs three digits so an ordinary next value ("35 15 more") remains separate.
  const numbers = [
    ...text.matchAll(
      /[+-]?(?:[0-9]+(?:[.,_'’\u00a0\u202f][0-9]+| [0-9]{3}(?![0-9]))*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/gu,
    ),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  for (const match of text.matchAll(new RegExp(escape(quote), "gu"))) {
    const start = match.index,
      end = start + quote.length;
    const startsInsideNumber =
      /^[0-9]/.test(quote) &&
      numbers.some((number) => number.start < start && number.end > start);
    const endsInsideNumber =
      /[0-9]$/.test(quote) &&
      numbers.some((number) => number.start < end && number.end > end);
    if (!startsInsideNumber && !endsInsideNumber) return true;
  }
  return false;
}

/** Action-specific typed content; never infer identity from document prose or JSON. */
export function citationReads(
  trace: Trace[],
  assertion: CitationAssertion,
): number[] {
  return trace
    .filter((entry) => {
      const result = entry.result;
      if (!result || result.error) return false;
      const matches = (
        record: any,
        identity: "id" | "path",
        content: "text" | "fact",
      ) =>
        record &&
        !record.error &&
        typeof record[identity] === "string" &&
        record[identity] === assertion.source &&
        typeof record[content] === "string" &&
        containsCitationEvidence(record[content], assertion.quote);
      switch (entry.call.action) {
        case "fixture.read":
          return (
            entry.call.input.id === assertion.source &&
            matches(result, "id", "text")
          );
        case "files.read":
          return (
            (entry.call.input.args as any)?.path === assertion.source &&
            matches(result, "path", "text")
          );
        case "chat.search":
          return (
            Array.isArray(result) &&
            result.some((record) => matches(record, "id", "text"))
          );
        case "memory.search":
          // The current memory fixture has no IDs; anonymous facts cannot prove a canonical source.
          return (
            Array.isArray(result) &&
            result.some((record) => matches(record, "id", "fact"))
          );
        default:
          return false;
      }
    })
    .map((entry) => entry.index);
}

export function citationSources(scenario: Scenario): CitationSource[] {
  const sources = new Map<string, Set<string>>();
  for (const assertion of scenario.assertions) {
    if (assertion.kind !== "citation") continue;
    const aliases = sources.get(assertion.source) ?? new Set<string>();
    for (const alias of assertion.aliases ?? []) aliases.add(alias);
    sources.set(assertion.source, aliases);
  }
  // Known other identities must also be recognized, so their markers cannot be borrowed.
  for (const document of scenario.fixture.documents ?? []) {
    const aliases = sources.get(document.id) ?? new Set<string>();
    // Original fixture A/B titles explicitly declare display names. Limit this inference
    // to unique uppercase letters equal to the canonical ID, not arbitrary public titles.
    if (
      scenario.provenance.kind === "original" &&
      /^[A-Z]$/.test(document.title) &&
      document.title.toLowerCase() === document.id &&
      scenario.fixture.documents!.filter(
        (other) => other.title === document.title,
      ).length === 1
    )
      aliases.add(document.title);
    sources.set(document.id, aliases);
  }
  return [...sources].map(([source, aliases]) => ({
    source,
    aliases: [...aliases],
  }));
}

function claimClauses(final: string, quotes: string[]): string[] {
  const protectedSpans = quotes.flatMap((quote) =>
    quote
      ? [...final.matchAll(new RegExp(escape(quote), "gu"))].map((match) => ({
          start: match.index,
          end: match.index + quote.length,
        }))
      : [],
  );
  const protectedAt = (index: number) =>
    protectedSpans.some((span) => span.start <= index && index < span.end);
  // Keep punctuation inside [source] intact, including file extensions and decimal IDs.
  const clauses: string[] = [];
  let start = 0,
    inMarker = false;
  for (let index = 0; index < final.length; index++) {
    const char = final[index];
    if (char === "[") inMarker = true;
    if (char === "]") inMarker = false;
    const groupedComma =
      char === "," &&
      /[0-9]/u.test(final[index - 1] ?? "") &&
      /[0-9]/u.test(final[index + 1] ?? "");
    const conjunction =
      !inMarker && !protectedAt(index)
        ? /^\s+(?:while|whereas|but|and)\s+/u.exec(final.slice(index))
        : null;
    const separator =
      !inMarker &&
      !protectedAt(index) &&
      !groupedComma &&
      (/[;,\n!?。；，！？]/u.test(char) ||
        (char === "." &&
          (index + 1 === final.length || /\s/u.test(final[index + 1]))));
    if (separator || conjunction) {
      clauses.push(final.slice(start, index));
      if (conjunction) index += conjunction[0].length - 1;
      start = index + 1;
    }
  }
  clauses.push(final.slice(start));
  return clauses
    .map((clause) =>
      clause.trim().replace(/^(?:while|whereas|but|and)\s+/u, ""),
    )
    .filter(Boolean);
}

/**
 * Canonical notation: quote [source], [source]: quote, or an explicit Alias-led
 * clause. One clause may identify only one source; ambiguous attribution fails closed.
 */
export function parseCitationClaims(
  final: string,
  sources: CitationSource[],
  quotes: string[] = [],
): CitationClaim[] {
  const labels = new Map<string, Set<string>>();
  for (const source of sources)
    for (const label of [source.source, ...source.aliases]) {
      const identities = labels.get(label) ?? new Set<string>();
      identities.add(source.source);
      labels.set(label, identities);
    }
  const claims: CitationClaim[] = [];
  for (const clause of claimClauses(final, quotes)) {
    const identities = new Set<string>();
    let unknownMarker = false;
    for (const marker of clause.matchAll(/\[([^\]\n]+)\]/gu)) {
      const label = marker[1].trim();
      const known = labels.get(label);
      if (!known) unknownMarker = true;
      else for (const source of known) identities.add(source);
    }
    const prose = clause.replace(/\[[^\]\n]+\]/gu, " ");
    const leading = clause.replace(/^(?:[-*]\s+|\d+\.\s+)/u, "");
    let evidenceText = prose.replace(/^(?:[-*]\s+|\d+\.\s+)/u, "");
    for (const source of sources) {
      for (const alias of source.aliases) {
        const marker = new RegExp(
          `(?<![\\p{L}\\p{N}_-])${escape(alias)}(?=$|[^\\p{L}\\p{N}_-])`,
          "gu",
        );
        if (marker.test(prose)) {
          for (const identity of labels.get(alias)!) identities.add(identity);
          evidenceText = evidenceText.replace(marker, " ");
        }
      }
      // Bare IDs need an explicit label delimiter; ordinary words never count as IDs.
      const marker = new RegExp(`^${escape(source.source)}\\s*[:：=]`, "u");
      if (marker.test(leading)) {
        for (const identity of labels.get(source.source)!)
          identities.add(identity);
        evidenceText = evidenceText.replace(marker, " ");
      }
    }
    if (!unknownMarker && identities.size === 1) {
      const source = [...identities][0];
      if (sources.some((candidate) => candidate.source === source))
        // Source labels establish attribution, but never supply quoted evidence.
        claims.push({ source, text: evidenceText });
    }
  }
  return claims;
}

export function scoreCitation(
  scenario: Scenario,
  trace: Trace[],
  final: string,
  assertion: CitationAssertion,
) {
  const reads = citationReads(trace, assertion);
  const quotes = scenario.assertions
    .filter(
      (candidate): candidate is CitationAssertion =>
        candidate.kind === "citation",
    )
    .map((candidate) => candidate.quote);
  const claims = parseCitationClaims(
    final,
    citationSources(scenario),
    quotes,
  ).filter(
    (claim) =>
      claim.source === assertion.source &&
      containsCitationEvidence(claim.text, assertion.quote),
  );
  return {
    passed: reads.length > 0 && claims.length > 0,
    evidence: { reads, claims },
  };
}
