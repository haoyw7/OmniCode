import { opendir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export async function canonical(path: string) {
  return realpath(path).catch(() => path);
}
export async function fingerprint(path: string) {
  const value = await stat(path);
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
}
/** Never follow nested symlinks into unrelated histories or directory cycles. */
export async function* usageFiles(
  root: string,
  accept: (name: string) => boolean,
): AsyncGenerator<string> {
  const directory = await opendir(root);
  for await (const entry of directory) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* usageFiles(path, accept);
    else if (entry.isFile() && accept(entry.name)) yield path;
  }
}
export const yieldUsage = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
