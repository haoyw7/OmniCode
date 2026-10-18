import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { evalDataRoot, readDatasetLock } from "./evalData";

export async function verifyPublicIntegrity(
  root: string,
  sources?: readonly string[],
) {
  const bytes = await readFile(join(root, "public/integrity.json"));
  const lock = JSON.parse(bytes.toString());
  const datasets = readDatasetLock(root);
  const external = new Set(
    Object.values(datasets?.sources ?? {}).flatMap((source) =>
      Object.keys(source.files),
    ),
  );
  const actual: Record<string, string> = {};
  async function scan(directory: string, base: string) {
    if ((await lstat(directory)).isSymbolicLink())
      throw Error(`Public artifact symlink rejected: ${directory}`);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
      const path = join(directory, entry.name);
      const key = relative(base, path).split(sep).join("/");
      if (base === root && key === "public/integrity.json") continue;
      if (entry.isSymbolicLink())
        throw Error(`Public artifact symlink rejected: ${key}`);
      if (entry.isDirectory()) await scan(path, base);
      else if (entry.isFile()) {
        if (Object.hasOwn(actual, key))
          throw Error(`Public artifact inventory drift: duplicate ${key}`);
        actual[key] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  }
  await scan(join(root, "public"), root);
  for (const directory of [
    "data/upstream/bfcl-v4-sample",
    "data/upstream/longmemeval-oracle-sample",
  ])
    await scan(join(root, directory), root);
  const expected: Record<string, string> = Object.fromEntries(
    Object.entries(lock.files as Record<string, string>).filter(
      ([path]) => !external.has(path),
    ),
  );
  if (datasets) {
    const selected =
      sources ??
      Object.keys(datasets.sources).filter((source) => source !== "original");
    for (const source of new Set(selected)) {
      const dataset = datasets.sources[source];
      if (!dataset || source === "original")
        throw Error(`Unknown public dataset: ${source}`);
      Object.assign(expected, dataset.files);
      // A source is published atomically and contains only locked payload files.
      // Scan its whole directory so injected executable files cannot evade verification.
      const base = join(evalDataRoot(root), source);
      await scan(base, base);
    }
  }
  if (
    JSON.stringify(Object.keys(actual).sort()) !==
    JSON.stringify(Object.keys(expected).sort())
  )
    throw Error(
      "Public artifact inventory drift; investigate added/removed files before running adapters",
    );
  for (const [path, digest] of Object.entries(actual))
    if (expected[path] !== digest)
      throw Error(`Public artifact hash drift: ${path}`);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    files: Object.keys(actual).length,
  };
}
