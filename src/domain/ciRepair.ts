

export const EVIDENCE_SEPARATOR = "\n\nCI evidence:\n";


/** The budget is soft: instructions and selected checks must survive compaction. */
export function compactCiRepairContext(
  context: string,
  maxChars: number,
): string {
  if (context.length <= maxChars) return context;
  const evidenceStart = context.indexOf(EVIDENCE_SEPARATOR);
  // Saved prompts without an explicit evidence section cannot be safely shortened.
  if (evidenceStart < 0) return context;
  const prefixEnd = evidenceStart + EVIDENCE_SEPARATOR.length;
  const prefix = context.slice(0, prefixEnd);
  const evidence = context.slice(prefixEnd);
  const marker = "\n\n[CI evidence truncated]";
  const evidenceBudget = Math.max(0, maxChars - prefix.length - marker.length);
  return `${prefix}${evidence.slice(0, evidenceBudget)}${marker}`;
}
