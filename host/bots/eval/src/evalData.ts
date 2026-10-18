import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type DatasetLock = {
  version: number;
  sources: Record<string, { files: Record<string, string> }>;
};

const expandHome = (path: string) =>
  path === "~"
    ? homedir()
    : path.startsWith("~/")
      ? join(homedir(), path.slice(2))
      : path;

export function readDatasetLock(root: string): DatasetLock | undefined {
  try {
    return JSON.parse(
      readFileSync(join(root, "data/datasets.lock.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function evalDataRoot(root: string): string {
  if (process.env.MONOCODE_EVAL_DATA_ROOT)
    return resolve(expandHome(process.env.MONOCODE_EVAL_DATA_ROOT));
  const digest = createHash("sha256")
    .update(readFileSync(join(root, "data/datasets.lock.json")))
    .digest("hex")
    .slice(0, 16);
  return resolve(
    expandHome(
      process.env.MONOCODE_EVAL_CACHE ||
        join(
          process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
          "monocode",
          "eval",
        ),
    ),
    digest,
  );
}

/** Historical runs are user artifacts, separate from reproducible dataset caches. */
export function evalArchiveRoot(root: string): string {
  if (!readDatasetLock(root)) return resolve(root);
  return resolve(
    expandHome(
      process.env.MONOCODE_EVAL_ARCHIVE_ROOT ||
        join(
          process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
          "monocode",
          "eval-archive",
        ),
    ),
  );
}

function checkRelativePath(path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Invalid evaluation data path");
}

export function evalArtifactPath(root: string, relativePath: string): string {
  checkRelativePath(relativePath);
  return resolve(evalArchiveRoot(root), relativePath);
}

/** The trusted root for this exact logical file; callers retain symlink containment checks. */
export function evalPathRoot(root: string, relativePath: string): string {
  checkRelativePath(relativePath);
  const lock = readDatasetLock(root);
  if (
    lock &&
    (relativePath === "reports" || relativePath.startsWith("reports/"))
  )
    return evalArchiveRoot(root);
  const external =
    lock &&
    Object.entries(lock.sources).find(([, source]) =>
      Object.hasOwn(source.files, relativePath),
    );
  return external ? join(evalDataRoot(root), external[0]) : resolve(root);
}

/** Only locked payloads and report artifacts are redirected outside the checkout. */
export function evalDataPath(root: string, relativePath: string): string {
  return resolve(evalPathRoot(root, relativePath), relativePath);
}

export async function safeEvalDataPath(
  root: string,
  relativePath: string,
): Promise<string> {
  const base = await realpath(evalPathRoot(root, relativePath));
  const path = await realpath(evalDataPath(root, relativePath));
  const rel = relative(base, path);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new Error("Evaluation evidence path escapes its storage root");
  return path;
}

export async function readEvalText(
  root: string,
  relativePath: string,
): Promise<string> {
  try {
    return await readFile(await safeEvalDataPath(root, relativePath), "utf8");
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      relativePath.startsWith("reports/") &&
      readDatasetLock(root)
    )
      throw new Error(
        `Historical evaluation artifact is unavailable: ${relativePath}. Set MONOCODE_EVAL_ARCHIVE_ROOT to the external archive containing reports/.`,
      );
    throw error;
  }
}

/** Accept explicit external inputs and preserve logical reports/... CLI paths. */
export function resolveEvalInputPath(root: string, path: string): string {
  if (path === "reports" || path.startsWith("reports/"))
    return evalDataPath(root, path);
  const absolute = resolve(path),
    rel = relative(resolve(root), absolute).split("\\").join("/");
  return rel === "reports" || rel.startsWith("reports/")
    ? evalDataPath(root, rel)
    : absolute;
}

export async function requireEvalInputPath(
  root: string,
  path: string,
): Promise<string> {
  const resolved = resolveEvalInputPath(root, path);
  try {
    return await realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        `Evaluation artifact is unavailable: ${resolved}. Supply an existing external path or set MONOCODE_EVAL_ARCHIVE_ROOT to the archive containing reports/.`,
      );
    throw error;
  }
}

async function prospectiveRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await prospectiveRealpath(parent), relative(parent, path));
  }
}

export async function assertEvalOutputOutsideProject(
  root: string,
  out: string,
): Promise<void> {
  if (!readDatasetLock(root)) return;
  const project = await realpath(resolve(root, "../../.."));
  const path = await prospectiveRealpath(resolve(out));
  const rel = relative(project, path);
  if (
    !rel ||
    (!rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel))
  )
    throw new Error(
      "Evaluation reports must be stored outside the project; use MONOCODE_EVAL_ARCHIVE_ROOT or an external --out directory.",
    );
}

/** Acquisition happens before the isolated, network-denied evaluation bridge starts. */
export async function ensureEvalData(
  root: string,
  sources: readonly string[],
): Promise<string> {
  const selected = [...new Set(sources)];
  const lock = readDatasetLock(root);
  if (!lock) return root;
  if (
    !selected.length ||
    selected.some((source) => !Object.hasOwn(lock.sources, source))
  )
    throw new Error("Unknown evaluation dataset");
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(
      "python3",
      [
        "-B",
        join(root, "bin/prepare_data.py"),
        "--sources",
        selected.join(","),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          MONOCODE_EVAL_ARCHIVE_ROOT: evalArchiveRoot(root),
          PYTHONDONTWRITEBYTECODE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolveOutput(stdout)
        : reject(
            new Error(
              `Evaluation data preparation failed (${code}): ${stderr.trim()}`,
            ),
          ),
    );
  });
  const result = JSON.parse(output.trim().split("\n").at(-1) ?? "{}");
  if (typeof result.root !== "string" || !isAbsolute(result.root))
    throw new Error(
      "Evaluation data preparation returned no absolute cache root",
    );
  process.env.MONOCODE_EVAL_DATA_ROOT = result.root;
  return result.root;
}
