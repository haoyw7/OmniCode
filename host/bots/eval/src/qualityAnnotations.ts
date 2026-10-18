import { safeEvalDataPath } from "./evalData";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { CaseSchema } from "./schema";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const opinion = z
  .object({
    reviewerId: z.string().min(1),
    actualReviewerType: z.literal("human"),
    independent: z.literal(true),
    initialBlind: z.literal(true),
    candidateAnonymized: z.literal(true),
    verdict: z.enum(["ambiguous", "sound", "unsupported_gold"]),
    evidenceLines: z.array(z.number().int().positive()).min(1),
    rationale: z.string().min(1),
  })
  .strict();
const fields = {
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  caseHash: hash,
  caseHashMethod: z.enum(["case-schema-json", "json-record-json"]),
  sourceLineSha256: hash,
  sourceFileSha256: hash,
  issueKind: z.enum(["prompt_ambiguity", "payee_attribution"]),
  evidencePath: z.string().min(1),
  evidenceLines: z.array(z.number().int().positive()).min(1),
  pairId: z.string().min(1).optional(),
  reviewerIds: z.array(z.string().min(1)).max(2),
  opinions: z.array(opinion).max(2),
  rationale: z.string().min(1),
};
export const QualityAnnotationSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...fields,
      state: z.literal("pending"),
      disposition: z.literal("preserve_pending"),
    })
    .strict(),
  z
    .object({
      ...fields,
      state: z.literal("adjudicated"),
      reviewerIds: z.array(z.string().min(1)).length(2),
      opinions: z.array(opinion).length(2),
      disposition: z.enum(["keep_original_gold", "exclude_adjudicated_subset"]),
      adjudicationRationale: z.string().min(1),
    })
    .strict(),
]);
export type QualityAnnotation = z.infer<typeof QualityAnnotationSchema>;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export async function readQualityAnnotations(
  root: string,
  path = "data/quality-annotations.jsonl",
): Promise<QualityAnnotation[]> {
  const text = await readFile(await inside(root, path), "utf8");
  return validateQualityAnnotations(
    root,
    text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
  );
}
async function inside(root: string, path: string) {
  try {
    return await safeEvalDataPath(root, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new Error("QUALITY_EVIDENCE_PATH_INVALID", { cause: error });
  }
}
export async function validateQualityAnnotations(
  root: string,
  input: unknown[],
): Promise<QualityAnnotation[]> {
  const rows = input.map((row) => QualityAnnotationSchema.parse(row));
  const seen = new Set<string>(),
    files = new Map<string, string>();
  for (const row of rows) {
    if (seen.has(row.caseId)) throw new Error("QUALITY_DUPLICATE_CASE");
    seen.add(row.caseId);
    if (
      new Set(row.reviewerIds).size !== row.reviewerIds.length ||
      new Set(row.opinions.map((o) => o.reviewerId)).size !==
        row.opinions.length ||
      row.reviewerIds.length !== row.opinions.length ||
      row.opinions.some((o) => !row.reviewerIds.includes(o.reviewerId))
    )
      throw new Error("QUALITY_REVIEWERS_INVALID");
    if (!files.has(row.evidencePath))
      files.set(
        row.evidencePath,
        await readFile(await inside(root, row.evidencePath), "utf8"),
      );
    const text = files.get(row.evidencePath)!;
    if (digest(text) !== row.sourceFileSha256)
      throw new Error("QUALITY_SOURCE_FILE_HASH_MISMATCH");
    // Exactly one physical JSONL source line; newline separator excluded from line hash.
    if (row.evidenceLines.length !== 1)
      throw new Error("QUALITY_CASE_LINE_INVALID");
    const line = text.split("\n")[row.evidenceLines[0] - 1];
    if (!line || digest(line) !== row.sourceLineSha256)
      throw new Error("QUALITY_SOURCE_LINE_HASH_MISMATCH");
    const record = JSON.parse(line);
    if (record.id !== row.caseId) throw new Error("QUALITY_CASE_ID_MISMATCH");
    const canonical =
      row.caseHashMethod === "case-schema-json"
        ? CaseSchema.parse(record)
        : record;
    if (digest(JSON.stringify(canonical)) !== row.caseHash)
      throw new Error("QUALITY_CASE_HASH_MISMATCH");
    if (
      row.opinions.some((o) =>
        o.evidenceLines.some((n) => !row.evidenceLines.includes(n)),
      )
    )
      throw new Error("QUALITY_REVIEW_EVIDENCE_INVALID");
    if (
      row.issueKind === "payee_attribution" &&
      (!row.pairId || record.upstream_id !== row.pairId)
    )
      throw new Error("QUALITY_PAIR_INVALID");
  }
  for (const row of rows.filter((r) => r.pairId)) {
    const group = rows.filter((r) => r.pairId === row.pairId);
    const records = files
      .get(row.evidencePath)!
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const pair = records.filter((r) => r.upstream_id === row.pairId);
    if (
      group.length !== pair.length ||
      pair.length < 2 ||
      !pair.some((r) => r.variant === "clean") ||
      !pair.some((r) => r.variant === "attacked") ||
      pair.some((r) => !group.some((a) => a.caseId === r.id)) ||
      group.some(
        (r) =>
          r.state !== row.state ||
          r.disposition !== row.disposition ||
          r.evidencePath !== row.evidencePath,
      )
    )
      throw new Error("QUALITY_PAIR_INCOMPLETE_OR_ASYMMETRIC");
  }
  return rows;
}
