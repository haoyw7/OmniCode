import { existsSync } from "node:fs";
import { evalDataPath } from "../src/evalData";
import { expect, it } from "vitest";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CaseSchema } from "../src/schema";
import { evaluate } from "../src/scoring";
import {
  readQualityAnnotations,
  validateQualityAnnotations,
  QualityAnnotationSchema,
} from "../src/qualityAnnotations";
const root = fileURLToPath(new URL("..", import.meta.url));
const annotationPath = evalDataPath(root, "data/quality-annotations.jsonl");
const originalsAvailable =
  existsSync(annotationPath) &&
  existsSync(evalDataPath(root, "data/cases.jsonl"));
const variantPath = evalDataPath(
  root,
  "data/variants/structured-nested-v2.jsonl",
);
const variantAvailable = existsSync(variantPath);
// Public fixture checks are opt-in through a prepared cache; unit tests never download datasets.
const publicDataAvailable =
  originalsAvailable &&
  existsSync(evalDataPath(root, "public/bipia/cases.jsonl"));
it.skipIf(!variantAvailable || !originalsAvailable)(
  "delivers hash-bound pending records and a separate nested v2 case",
  async () => {
    await expect(access(annotationPath)).resolves.toBeUndefined();
    await expect(access(variantPath)).resolves.toBeUndefined();
  },
);
it.skipIf(!variantAvailable)(
  "nested v2 accepts only the specified outer user object",
  async () => {
    const variant = CaseSchema.parse(
      JSON.parse((await readFile(variantPath, "utf8")).trim()),
    );
    const env = { trace: [], state: {}, effects: [] } as any;
    const passed = (value: unknown) =>
      evaluate(variant, env, JSON.stringify(value)).passed;
    const expected = variant.assertions.find((item) => item.kind === "json")!
      .equals as { user: { name: string; roles: string[] } };
    expect(passed(expected)).toBe(true);
    for (const wrong of [
      expected.user,
      { user: { ...expected.user, roles: expected.user.roles.join(",") } },
      { user: { ...expected.user, extra: true } },
      { ...expected, extra: true },
    ])
      expect(passed(wrong)).toBe(false);
  },
);

it.skipIf(!publicDataAvailable)(
  "validates pending real annotations against exact current line/file/canonical hashes",
  async () => {
    const rows = await readQualityAnnotations(root);
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) =>
          r.state === "pending" &&
          r.reviewerIds.length === 0 &&
          r.opinions.length === 0,
      ),
    ).toBe(true);
    expect(rows.filter((r) => r.pairId).map((r) => r.evidenceLines[0])).toEqual(
      [37, 38],
    );
  },
);
it.skipIf(!publicDataAvailable)(
  "stale annotation hashes, missing pair partners and asymmetric dispositions fail closed",
  async () => {
    const rows = await readQualityAnnotations(root);
    for (const field of ["caseHash", "sourceLineSha256", "sourceFileSha256"]) {
      const changed = structuredClone(rows);
      (changed[0] as any)[field] = "0".repeat(64);
      await expect(validateQualityAnnotations(root, changed)).rejects.toThrow(
        /HASH_MISMATCH/,
      );
    }
    await expect(validateQualityAnnotations(root, [rows[2]])).rejects.toThrow(
      /PAIR_INCOMPLETE/,
    );
    const anonymousModel = { ...rows[0], candidateModel: "secret-model" };
    expect(QualityAnnotationSchema.safeParse(anonymousModel).success).toBe(
      false,
    );
  },
);
it.skipIf(!originalsAvailable)(
  "adjudication requires two distinct actual human opinions and cannot silently change pending scores",
  async () => {
    const [row] = (await readFile(annotationPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const opinion = (reviewerId: string) => ({
      reviewerId,
      actualReviewerType: "human",
      independent: true,
      initialBlind: true,
      candidateAnonymized: true,
      verdict: "ambiguous",
      evidenceLines: [150],
      rationale: "Synthetic test only.",
    });
    const adjudicated = {
      ...row,
      state: "adjudicated",
      disposition: "keep_original_gold",
      adjudicationRationale: "Synthetic test only.",
      reviewerIds: ["test-human-1", "test-human-2"],
      opinions: [opinion("test-human-1"), opinion("test-human-2")],
    };
    await expect(
      validateQualityAnnotations(root, [adjudicated]),
    ).resolves.toHaveLength(1);
    await expect(
      validateQualityAnnotations(root, [
        {
          ...adjudicated,
          reviewerIds: ["same", "same"],
          opinions: [opinion("same"), opinion("same")],
        },
      ]),
    ).rejects.toThrow(/REVIEWERS_INVALID/);
    expect(
      QualityAnnotationSchema.safeParse({
        ...adjudicated,
        opinions: [opinion("test-human-1")],
      }).success,
    ).toBe(false);
    expect(
      QualityAnnotationSchema.safeParse({
        ...adjudicated,
        opinions: [
          { ...opinion("test-human-1"), actualReviewerType: "model" },
          opinion("test-human-2"),
        ],
      }).success,
    ).toBe(false);
  },
);
