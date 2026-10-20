import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import source from "../src/integrations/harness/providers/workbuddy/workbuddyRuntime.cjs?raw";
import type { WorkBuddyAccount, WorkBuddyCatalog } from "../src/integrations/harness/core/catalog";

const exec = promisify(execFile);
type Options = { binaryPath?: string | null; accountId?: string; configRoot?: string };
type Installation = { executable: string; cliVersion: string };
type Runtime = {
  accounts(options: Options): WorkBuddyAccount[];
  installations(options: Options): Installation[];
  select(options: Options): Installation;
};
export function workBuddyOptionsForOwner(owner?: string): Options {
  if (!owner) return {};
  try {
    const configured = JSON.parse(readFileSync(owner, "utf8")).providerBinaryPaths?.workbuddy;
    return typeof configured === "string" && configured.trim() ? { binaryPath: configured.trim() } : {};
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
let script: string | undefined;
let loaded: Runtime | undefined;
export function workBuddyRuntimePath(): string {
  if (script) return script;
  const directory = join(tmpdir(), "omnicode-workbuddy-" + createHash("sha256").update(source).digest("hex"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "runtime.cjs");
  let cached: string | undefined;
  try { cached = readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (cached !== source) writeFileSync(file, source, { mode: 0o600 });
  script = file;
  return file;
}
function runtime(): Runtime {
  return loaded ??= createRequire(import.meta.url)(workBuddyRuntimePath()) as Runtime;
}
export function workBuddyAccounts(options: Options = {}): WorkBuddyAccount[] {
  return runtime().accounts(options);
}
export function resolveWorkBuddy(options: Options = {}): string {
  const installed = options.accountId ? runtime().select(options) : runtime().installations(options)[0];
  if (!installed) throw new Error("WorkBuddy is not installed");
  return installed.executable;
}
export function workBuddyVersion(options: Options = {}): string {
  return runtime().installations(options)[0]?.cliVersion || "unknown";
}
export function workBuddyLaunch(options: Options, args: string[]) {
  return { command: resolveWorkBuddy(options), args: [workBuddyRuntimePath(), "run", JSON.stringify(options), ...args] };
}
export async function workBuddyCatalog(options: Options = {}): Promise<WorkBuddyCatalog> {
  const { stdout } = await exec(resolveWorkBuddy(options), [workBuddyRuntimePath(), "catalog", JSON.stringify(options)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 65000, maxBuffer: 2 * 1024 * 1024,
  });
  const result = JSON.parse(stdout) as WorkBuddyCatalog;
  if (!Array.isArray(result.models)) throw new Error("WorkBuddy initialization failed");
  return result;
}
