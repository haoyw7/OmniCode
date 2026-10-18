import { createHash } from "node:crypto";
export function buildPairedOrder(
  ids: string[],
  arms: [string, string],
  seed: number,
) {
  if (new Set(ids).size !== ids.length) throw Error("Duplicate paired ID");
  if (arms[0] === arms[1]) throw Error("Duplicate arm");
  const shuffled = [...ids].sort((a, b) =>
    createHash("sha256")
      .update(`${seed}:${a}`)
      .digest("hex")
      .localeCompare(createHash("sha256").update(`${seed}:${b}`).digest("hex")),
  );
  return shuffled.flatMap((id, index) => {
    const pair = (index + seed) % 2 ? [...arms].reverse() : arms;
    return pair.map((arm) => ({ id, arm, seed, repeat: 0 }));
  });
}
export function expandUnrun(
  catalog: { id: string; group: string; upstreamId: string }[],
  previouslyRun: Set<string>,
  limit: number,
): string[] {
  if (!Number.isInteger(limit) || limit < 0)
    throw Error("Invalid sample limit");
  const units = new Map<string, typeof catalog>();
  for (const row of catalog) {
    const rows = units.get(row.upstreamId) ?? [];
    rows.push(row);
    units.set(row.upstreamId, rows);
  }
  const groups = new Map<string, (typeof catalog)[]>();
  for (const unit of units.values()) {
    if (unit.some((x) => previouslyRun.has(x.id))) continue;
    const group = unit[0].group,
      queue = groups.get(group) ?? [];
    queue.push(unit);
    groups.set(group, queue);
  }
  const result: string[] = [];
  while ([...groups.values()].some((queue) => queue.length)) {
    for (const queue of groups.values()) {
      const unit = queue.shift();
      if (unit && result.length + unit.length <= limit)
        result.push(...unit.map((x) => x.id));
    }
  }
  return result;
}

/** Explicit lineage, not suffix guessing: prompt variants share an independent problem. */
export function originalProblemId(id: string): string {
  return id === "structured-nested-v2" ? "structured-nested" : id;
}
