const sources = new WeakMap<object, number>();
let sourceId = 0;

/** Readers are scoped to a workspace/Host; run IDs alone are not global. */
export function workflowQueryScope(reader: object) {
  if (!sources.has(reader)) sources.set(reader, ++sourceId);
  return ["workflow", sources.get(reader)!] as const;
}
