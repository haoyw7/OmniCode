import { currentMachineIO, machineFs, machinePath } from "./machine-io";
import { homedir } from "node:os";
import type { HostDirectory } from "../src/features/connections/model/protocol";

/** Lists host directories for the project picker without reading file contents. */
export async function browseHostDirectories(
  rawPath: unknown,
): Promise<HostDirectory> {
  const { readdir, stat } = machineFs;
  const { dirname, isAbsolute, parse, resolve } = machinePath;
  if (
    rawPath !== undefined &&
    (typeof rawPath !== "string" ||
      rawPath.length > 4096 ||
      rawPath.includes("\0"))
  )
    throw new Error("Invalid directory path");
  const requested =
    typeof rawPath === "string" && rawPath.trim() ? rawPath : currentMachineIO().key === "local" ? homedir() : "/";
  if (!isAbsolute(requested))
    throw new Error("Choose an absolute directory path");
  const path = resolve(requested);
  if (!(await stat(path)).isDirectory())
    throw new Error("Path is not a directory");
  const directories = await Promise.all(
    (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry) => {
        const entryPath = resolve(path, entry.name);
        if (
          entry.isSymbolicLink() &&
          !(await stat(entryPath).then(
            (target) => target.isDirectory(),
            () => false,
          ))
        )
          return null;
        // Keep the link's location so going up returns to the folder it appeared in.
        return { name: entry.name, path: entryPath };
      }),
  );
  const entries = directories
    .filter(
      (entry): entry is HostDirectory["entries"][number] => entry !== null,
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500);
  return {
    path,
    parent: path === parse(path).root ? null : dirname(path),
    entries,
  };
}
