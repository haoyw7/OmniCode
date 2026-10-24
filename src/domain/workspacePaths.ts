import { normalizeProjectPath } from "./pathDisplay";

/** Compare execution paths using their syntax, independently of the observing client. */
export function workspacePathKey(path: string): string {
  const normalized = normalizeProjectPath(path);
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function workspacePathIsInside(path: string, root: string): boolean {
  const key = workspacePathKey(path);
  const base = workspacePathKey(root);
  return key === base || key.startsWith(`${base}/`);
}
