/** Populated by native bootstrap before restoring the workspace. */
let retiredIds: ReadonlySet<string> = new Set();

export function setRetiredSessionIds(ids: readonly string[]): void {
  retiredIds = new Set(ids);
}

export function isRetiredSession(id: string, cwd?: string): boolean {
  // A different remote environment may legally have the same wire session ID.
  return !cwd?.startsWith("remote://") && retiredIds.has(id);
}
