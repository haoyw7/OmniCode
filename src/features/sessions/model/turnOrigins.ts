import type { Block } from "./session";

/** Native files are not an authority for MonoCode sender identity. Only stable
 * message/turn IDs can carry an existing Host origin into a refreshed transcript.
 * Keep unmatched app turns as overlays rather than guess from repeated text. */
export function retainTurnOrigins(
  previous: Block[],
  incoming: Block[],
): Block[] {
  const trusted = previous.filter(
    (block) => block.role === "user" && block.origin,
  );
  const matched = new Set<string>();
  const blocks = incoming.map((block) => {
    const { origin: _untrusted, ...clean } = block;
    if (block.role !== "user") return clean;
    const source = trusted.find(
      (old) =>
        old.id === block.id ||
        (old.providerTurnId && old.providerTurnId === block.providerTurnId),
    );
    if (!source) return clean;
    matched.add(source.id);
    return { ...clean, origin: source.origin };
  });
  return [...blocks, ...trusted.filter((block) => !matched.has(block.id))];
}
