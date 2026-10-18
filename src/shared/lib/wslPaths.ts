export const WSL_PATH_PREFIX = "wsl://";
export type WslProjectMachine = { kind: "wsl"; distribution: string };

/** Windows folder pickers expose Linux folders through either WSL UNC server. */
export function parseWslUncPath(path: string): { machine: WslProjectMachine; hostPath: string } | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\/\/\?\/UNC\//i, "//");
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i.exec(normalized);
  if (!match) return;
  const distribution = match[1];
  const hostPath = match[2]?.replace(/\/+$/, "") || "/";
  try {
    wslPath(distribution, hostPath);
    return { machine: { kind: "wsl", distribution }, hostPath };
  } catch { return; }
}

/** Desktop identity only. Host records and Linux commands keep the raw POSIX path. */
export function wslPath(distribution: string, path: string): string {
  if (!distribution.trim() || /[\\/\0\r\n]/.test(distribution) || !path.startsWith("/") || path.includes("\0"))
    throw new Error("Invalid WSL project path");
  return `${WSL_PATH_PREFIX}${encodeURIComponent(distribution)}${path}`;
}

export function parseWslPath(path: string): { machine: WslProjectMachine; hostPath: string } | undefined {
  if (!path.startsWith(WSL_PATH_PREFIX)) return;
  const rest = path.slice(WSL_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  try {
    const distribution = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
    const hostPath = slash < 0 ? "/" : rest.slice(slash);
    wslPath(distribution, hostPath);
    return { machine: { kind: "wsl", distribution }, hostPath };
  } catch { return; }
}
