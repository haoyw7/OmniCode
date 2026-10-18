import { createHash } from "node:crypto";
import type { Scenario } from "./schema";
import { NATIVE_MODEL, NATIVE_TIME } from "./nativePiFixtureAdapter";
import { nativeHostSupport } from "./nativeHostFixtureAdapter";
export const NATIVE_DIMENSIONS = [
  "memory",
  "recovery",
  "files",
  "permissions",
  "degradation",
  "structured",
] as const;
export interface ComparisonManifest {
  status: "ready" | "blocked";
  seed: number;
  model: string;
  thinking: "low";
  time: string;
  cases: {
    id: string;
    category: string;
    order: ["A", "B"] | ["B", "A"];
    scenarioHash: string;
  }[];
  blockers: string[];
  hash: string;
  limitations: string[];
}
/** Select sorted native IDs and freeze before outcomes exist; unsupported cases remain blockers. */
export function freezeNativeManifest(
  catalog: Scenario[],
  seed: number,
): ComparisonManifest {
  const cases: ComparisonManifest["cases"] = [],
    blockers: string[] = [];
  for (const dimension of NATIVE_DIMENSIONS) {
    const selected = catalog
      .filter((c) => c.support === "native" && c.category === dimension)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 2);
    if (selected.length !== 2)
      blockers.push(
        `${dimension}: requires two native cases, found ${selected.length}`,
      );
    for (const scenario of selected) {
      for (const reason of nativeHostSupport(scenario).reasons)
        blockers.push(`${scenario.id}: ${reason}`);
      cases.push({
        id: scenario.id,
        category: dimension,
        order: ["A", "B"],
        scenarioHash: createHash("sha256")
          .update(JSON.stringify(scenario))
          .digest("hex"),
      });
    }
  }
  const ranked = cases
    .map((row) => ({
      row,
      key: createHash("sha256").update(`${seed}:${row.id}:order`).digest("hex"),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  ranked.forEach(({ row }, index) => {
    row.order = index < Math.ceil(ranked.length / 2) ? ["A", "B"] : ["B", "A"];
  });
  const body = {
    status: blockers.length ? ("blocked" as const) : ("ready" as const),
    seed,
    model: NATIVE_MODEL,
    thinking: "low" as const,
    time: NATIVE_TIME,
    cases,
    blockers,
    limitations: [
      "diagnostic sample; inference remains random",
      "Host control bridge uses Pi SDK independently of Host provider dispatch",
      "scripted native turn-boundary steering is not sessions.steer/cancel/persisted recovery",
      "fixture fault/session seeding unsupported; never silently replaced",
    ],
  };
  return {
    ...body,
    hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
}
