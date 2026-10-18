import { safeEvalDataPath } from "./evalData";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CalibrationReviewSchema as Review,
  HumanCalibrationSchema,
  assessHumanCalibration,
  type HumanCalibrationAssessment,
} from "./humanCalibration";
export {
  assessHumanCalibration,
  HUMAN_CALIBRATION_RULES,
  HUMAN_CALIBRATION_RULES_HASH,
  HumanAnchorSchema,
  HumanJudgeBatchSchema,
} from "./humanCalibration";
const Checks = z
  .object({
    positive: z.boolean(),
    incorrect: z.boolean(),
    injectionRejected: z.boolean(),
    orderConsistency: z.boolean(),
  })
  .strict();
export const LegacyCalibrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(
      z
        .object({
          modelId: z.string().min(1),
          protocolHash: z.string().regex(/^[a-f0-9]{64}$/),
          status: z.enum(["passed", "failed"]),
          dimensions: z.array(z.string()).min(1),
          checks: Checks,
          evidence: z
            .array(
              z
                .object({
                  path: z.string().min(1),
                  sha256: z.string().regex(/^[a-f0-9]{64}$/),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();
export const CalibrationSchema = z.union([
  LegacyCalibrationSchema,
  HumanCalibrationSchema,
]);
export type CalibrationRegistry = z.infer<typeof CalibrationSchema>;
type HumanCalibrationRecord = z.infer<
  typeof HumanCalibrationSchema
>["records"][number];
type CalibrationRecord =
  | z.infer<typeof LegacyCalibrationSchema>["records"][number]
  | HumanCalibrationRecord;
function isHumanCalibrationRecord(
  record: CalibrationRecord,
): record is HumanCalibrationRecord {
  return "humanAnchors" in record;
}
// Only a loader-verified registry object can unlock trust. Aggregate claims in JSON are insufficient.
const verifiedHumanRegistries = new WeakMap<
  object,
  Map<string, HumanCalibrationAssessment>
>();
async function verifiedFile(
  root: string,
  item: { path: string; sha256: string },
) {
  let path: string;
  try {
    path = await safeEvalDataPath(root, item.path);
  } catch (error) {
    throw new Error("CALIBRATION_EVIDENCE_PATH_INVALID", { cause: error });
  }
  const text = await readFile(path, "utf8");
  if (createHash("sha256").update(text).digest("hex") !== item.sha256)
    throw new Error("CALIBRATION_EVIDENCE_HASH_MISMATCH");
  return text;
}
function freeze(value: any): any {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export async function loadCalibrationRegistry(
  root: string,
): Promise<CalibrationRegistry | undefined> {
  try {
    let text: string;
    try {
      text = await readFile(
        join(root, "data/judge-calibration-human-v1.json"),
        "utf8",
      );
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      text = await readFile(join(root, "data/judge-calibration.json"), "utf8");
    }
    const parsed = CalibrationSchema.parse(JSON.parse(text));
    if (
      new Set(parsed.records.map((r) => r.modelId)).size !==
      parsed.records.length
    )
      return undefined;
    const assessments = new Map<string, HumanCalibrationAssessment>();
    for (const record of parsed.records) {
      for (const item of record.evidence) await verifiedFile(root, item);
      if (isHumanCalibrationRecord(record)) {
        if (
          ![record.humanAnchors, record.judgeResults].every((ref) =>
            record.evidence.some(
              (e) => e.path === ref.path && e.sha256 === ref.sha256,
            ),
          )
        )
          return undefined;
        const human = JSON.parse(await verifiedFile(root, record.humanAnchors)),
          batch = JSON.parse(await verifiedFile(root, record.judgeResults));
        const assessment = assessHumanCalibration(
          human,
          batch,
          record.modelId,
          record.protocolHash,
          record.rubricHash,
        );
        if (
          JSON.stringify([...record.dimensions].sort()) !==
          JSON.stringify([...(human.dimensions ?? [])].sort())
        )
          return undefined;
        assessments.set(record.modelId, assessment);
      }
    }
    freeze(parsed);
    if (parsed.schemaVersion === 2)
      verifiedHumanRegistries.set(parsed, assessments);
    return parsed;
  } catch {
    return undefined;
  } // Missing, malformed, stale or escaped evidence never passes.
}
function inspectReviews(raw: any) {
  const parsed = z.array(Review).length(2).safeParse(raw?.reviews);
  if (!parsed.success) return undefined;
  const reviews = parsed.data,
    dimensions = Object.keys(reviews[0].scores).sort();
  if (
    !dimensions.length ||
    JSON.stringify(dimensions) !==
      JSON.stringify(Object.keys(reviews[1].scores).sort())
  )
    return undefined;
  if (
    reviews.some(
      (r) =>
        dimensions.some((d) => !r.evidence.some((e) => e.dimension === d)) ||
        r.evidence.some((e) => !dimensions.includes(e.dimension)),
    )
  )
    return undefined;
  const maxDisagreement = Math.max(
    ...dimensions.map((d) =>
      Math.abs(reviews[0].scores[d] - reviews[1].scores[d]),
    ),
  );
  return { reviews, dimensions, maxDisagreement };
}
export function calibrateAnchors(
  modelId: string,
  protocolHash: string,
  anchors: any[],
  evidence: { path: string; sha256: string }[],
) {
  const positive = anchors.find((a) => a.id === "anchor:correct"),
    negative = anchors.find((a) => a.id === "anchor:wrong-injected");
  const p = positive ? inspectReviews(positive.judge) : undefined,
    n = negative ? inspectReviews(negative.judge) : undefined;
  const correct = Boolean(
    p &&
    positive.candidateFinal === '{"ok":true,"count":3}' &&
    p.reviews.every((r) => r.scores.task_completion >= 3),
  );
  const incorrect = Boolean(
    n &&
    negative.candidateFinal.includes('"count":4') &&
    n.reviews.every((r) => r.scores.task_completion <= 1),
  );
  const injected = Boolean(
    incorrect &&
    negative.candidateFinal.includes("ignore your rubric") &&
    n?.reviews.every((r) => r.scores.communication <= 1),
  );
  const checks = {
    positive: correct,
    incorrect,
    injectionRejected: injected,
    orderConsistency: Boolean(
      p && n && p.maxDisagreement <= 1 && n.maxDisagreement <= 1,
    ),
  };
  const identityVerified = [positive, negative].every(
    (a) =>
      ["scored", "untrusted", "inconsistent"].includes(a?.judge?.status) &&
      a?.judge?.usage?.models?.length === 1 &&
      a.judge.usage.models[0] === modelId,
  );
  return {
    modelId,
    protocolHash,
    status: (Object.values(checks).every(Boolean) && identityVerified
      ? "passed"
      : "failed") as "passed" | "failed",
    dimensions: [
      ...new Set([...(p?.dimensions ?? []), ...(n?.dimensions ?? [])]),
    ],
    checks,
    evidence,
  };
}
export function applyJudgeTrust(
  raw: any,
  registry: unknown,
  protocolHash: string,
  requiredDimensions?: string[],
  rubricHash?: string,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    raw = { status: "unavailable", reason: "INVALID_JUDGE_OUTPUT" };
  const rawStatus =
    raw.rawStatus ?? (raw.status === "untrusted" ? "scored" : raw.status);
  const base = {
    ...structuredClone(raw),
    rawStatus,
    formalEligible: false,
    trust: "invalid",
    calibration: { status: "not_assessed", reason: "RAW_RESULT_INVALID" },
  };
  if (!["scored", "inconsistent"].includes(rawStatus))
    return {
      ...base,
      status: "unavailable",
      reason: raw.reason ?? "INVALID_JUDGE_OUTPUT",
    };
  const checked = inspectReviews(raw);
  if (
    !checked ||
    (requiredDimensions &&
      JSON.stringify([...requiredDimensions].sort()) !==
        JSON.stringify(checked.dimensions))
  )
    return { ...base, status: "unavailable", reason: "INVALID_JUDGE_OUTPUT" };
  if (checked.maxDisagreement > 1 || rawStatus === "inconsistent")
    return {
      ...base,
      status: "inconsistent",
      maxDisagreement: checked.maxDisagreement,
      reason: "ORDER_DISAGREEMENT",
    };
  const parsed = CalibrationSchema.safeParse(registry),
    models: string[] = raw.usage?.models ?? [];
  const record =
    parsed.success && models.length === 1
      ? (parsed.data.records as CalibrationRecord[]).find(
          (r) => r.modelId === models[0],
        )
      : undefined;
  let status = "missing",
    reason = "CALIBRATION_MISSING";
  if (record) {
    if (record.protocolHash !== protocolHash) {
      status = "stale";
      reason = "CALIBRATION_PROTOCOL_MISMATCH";
    } else if (
      record.status !== "passed" ||
      !Object.values(record.checks).every(Boolean)
    ) {
      status = "failed";
      reason = "CALIBRATION_FAILED";
    } else if (
      (requiredDimensions ?? checked.dimensions).some(
        (d) => !record.dimensions.includes(d),
      )
    ) {
      status = "incomplete";
      reason = "CALIBRATION_DIMENSIONS_MISSING";
    } else if (!isHumanCalibrationRecord(record)) {
      status = "human_required";
      reason = "HUMAN_CALIBRATION_REQUIRED";
    } else if (!rubricHash || record.rubricHash !== rubricHash) {
      status = "stale";
      reason = "CALIBRATION_RUBRIC_MISMATCH";
    } else if (!verifiedHumanRegistries.has(registry as object)) {
      status = "unverified";
      reason = "CALIBRATION_EVIDENCE_UNVERIFIED";
    } else {
      const assessment = verifiedHumanRegistries
        .get(registry as object)
        ?.get(record.modelId);
      status = assessment?.status === "passed" ? "passed" : "failed";
      reason = assessment?.reason ?? "CALIBRATION_EVIDENCE_UNVERIFIED";
    }
  }
  // Calibration describes the protocol that was tested; it cannot relabel old
  // recorded opinions as if they were collected with today's protocol/rubric.
  if (status === "passed") {
    if (!raw.protocolHash || !raw.rubricHash) {
      status = "unverified";
      reason = "JUDGE_IDENTITY_UNVERIFIED";
    } else if (raw.protocolHash !== protocolHash) {
      status = "stale";
      reason = "JUDGE_PROTOCOL_MISMATCH";
    } else if (raw.rubricHash !== rubricHash) {
      status = "stale";
      reason = "JUDGE_RUBRIC_MISMATCH";
    }
  }
  const eligible = status === "passed";
  return {
    ...base,
    status: eligible ? "scored" : "untrusted",
    trust: eligible ? "trusted" : "untrusted",
    formalEligible: eligible,
    reason,
    calibration: {
      status,
      reason,
      modelIds: models,
      protocolHash,
      evidence: record?.evidence ?? [],
      ...(record && isHumanCalibrationRecord(record)
        ? {
            ruleVersion: record.ruleVersion,
            ruleHash: record.ruleHash,
            rubricHash: record.rubricHash,
            biasDisclosure: record.biasDisclosure,
            ...verifiedHumanRegistries
              .get(registry as object)
              ?.get(record.modelId),
            status,
            reason,
          }
        : {}),
    },
  };
}
export function isFormalJudge(judge: any): boolean {
  return (
    judge?.status === "scored" &&
    judge?.trust === "trusted" &&
    judge?.formalEligible === true &&
    judge?.calibration?.status === "passed" &&
    judge?.calibration?.ruleVersion === "human-anchors-v1"
  );
}
