/** Normalize display paths from their syntax, independent of the current runtime. */
export function normalizeProjectPath(path: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('//') || (!path.startsWith('/') && !path.startsWith('wsl://') && path.includes('\\'));
  return (windows ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '') || '/';
}
function displayPathKey(path: string): string {
  return /^[A-Za-z]:(?:\/|$)/.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}

/** Path relative to cwd when it lives under the project, otherwise unchanged. */
export function displayPath(path: string, cwd?: string): string {
  const normalized = normalizeProjectPath(path);
  const base = cwd ? normalizeProjectPath(cwd) : undefined;
  if (base && base !== "~") {
    const key = displayPathKey(normalized);
    const baseKey = displayPathKey(base);
    if (key === baseKey) {
      return normalized.split("/").filter(Boolean).pop() || normalized;
    }
    const prefix = `${base}/`;
    if (key.startsWith(`${baseKey}/`)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

