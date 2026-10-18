import { expect, it } from "vitest";
import {
  buildPairedOrder,
  expandUnrun,
  originalProblemId,
} from "../src/campaignSelection";
it("freezes balanced two-arm pairs without selecting from outcomes", () => {
  const ids = ["a", "b", "c", "d"];
  const rows = buildPairedOrder(ids, ["control", "monocode"], 17);
  expect(rows.map((x) => x.id).sort()).toEqual(
    ids.flatMap((id) => [id, id]).sort(),
  );
  expect(
    rows
      .filter((_, i) => i % 2 === 0)
      .map((x) => x.arm)
      .sort(),
  ).toEqual(["control", "control", "monocode", "monocode"]);
  expect(buildPairedOrder(ids, ["control", "monocode"], 17)).toEqual(rows);
  expect(() =>
    buildPairedOrder(["a", "a"], ["control", "monocode"], 17),
  ).toThrow(/duplicate/i);
});
it("expands only previously unrun IDs and preserves paired variants", () => {
  const catalog = [
    { id: "a", group: "one", upstreamId: "a" },
    { id: "b-clean", group: "two", upstreamId: "b" },
    { id: "b-attack", group: "two", upstreamId: "b" },
    { id: "c", group: "one", upstreamId: "c" },
  ];
  expect(expandUnrun(catalog, new Set(["a"]), 2)).toEqual([
    "b-clean",
    "b-attack",
  ]);
  expect(expandUnrun(catalog, new Set(["a"]), 1)).toEqual(["c"]);
  expect(expandUnrun(catalog, new Set(["b-clean"]), 4)).not.toContain(
    "b-attack",
  );
});

it("does not count a documented prompt variant as a new independent original", () => {
  expect(originalProblemId("structured-nested-v2")).toBe("structured-nested");
  expect(originalProblemId("new-v2")).toBe("new-v2");
});
