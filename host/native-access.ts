import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { NativeSessionLink } from "../src/features/sessions/model/session";
import type {
  NativeSessionAccess,
  NativeSessionHolder,
  NativeSessionProvider,
} from "../src/integrations/harness/core/nativeSessions";

/**
 * Host-side ownership for native sessions: an advisory lock file serializes
 * OmniCode writers, and a `/proc` scan keeps sessions read-only while an
 * external CLI may still be writing them.
 */

/** Lock file of one conversation; a shared database is locked per conversation. */
export function nativeLockPath(
  directory: string,
  link: Pick<NativeSessionLink, "path" | "providerSessionId" | "storage">,
): string {
  const key =
    link.storage === "sqlite" ? `${link.path}#${link.providerSessionId}` : link.path;
  return join(
    directory,
    "native-session-locks",
    `${createHash("sha256").update(key).digest("hex")}.lock`,
  );
}

export type NativeLease = { release(): Promise<void> };

export const IN_USE_BY_OMNICODE = "Native session is in use by another OmniCode instance";
export const OWNERSHIP_UNVERIFIED = "Native session ownership could not be verified";

/**
 * Node has no flock(2); util-linux `flock` holds the lock for as long as its
 * `cat` child keeps stdin open. Closing stdin (or the Host exiting) releases it.
 */
export function acquireNativeLease(
  lockPath: string,
  flockBinary = "flock",
): Promise<NativeLease> {
  mkdirSync(dirname(lockPath), { recursive: true });
  return new Promise((resolveLease, reject) => {
    const child = spawn(
      flockBinary,
      ["--nonblock", "--conflict-exit-code", "75", lockPath, "-c", "echo locked; exec cat"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(message));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || !String(chunk).includes("locked")) return;
      settled = true;
      let releasing: Promise<void> | undefined;
      resolveLease({
        release: () => releasing ??= new Promise<void>((released) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            released();
            return;
          }
          const timer = setTimeout(() => child.kill(), 1000);
          timer.unref();
          child.once("exit", () => {
            clearTimeout(timer);
            released();
          });
          child.stdin.end();
        }),
      });
    });
    child.on("error", () => fail(OWNERSHIP_UNVERIFIED));
    child.on("exit", (code) =>
      fail(code === 75 ? IN_USE_BY_OMNICODE : OWNERSHIP_UNVERIFIED),
    );
  });
}

type Proc = { pid: number; argv: string[] };

const PROVIDER_FLAGS: Record<string, readonly string[]> = {
  claude: ["--resume", "-r", "--session-id"],
  omp: ["--resume", "-r", "--session"],
  opencode: ["--session", "-s"],
};

export function providerArgv(argv: readonly string[], provider: string): boolean {
  return argv.slice(0, 3).some((arg) => {
    const name = basename(arg);
    switch (provider) {
      case "codex":
        return name === "codex" || name === "codex-cli" || arg.includes("/@openai/codex/");
      case "pi":
        return name === "pi" || arg.includes("/pi-coding-agent/") || arg.includes("/pi-agent/");
      case "claude":
        return (
          name === "claude" ||
          arg.includes("/@anthropic-ai/claude-code/") ||
          arg.includes("/claude/versions/")
        );
      case "omp":
        return name === "omp" || arg.includes("/oh-my-pi/");
      case "opencode":
        return name === "opencode" || name === "opencode.exe" || arg.includes("/opencode-ai/");
      default:
        return false;
    }
  });
}

export function explicitSession(argv: readonly string[], provider: string): string | undefined {
  const flags = PROVIDER_FLAGS[provider] ?? ["--session", "--resume", "resume"];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (flags.includes(arg) && next && !next.startsWith("-")) return next;
    const equals = arg.indexOf("=");
    if (arg.startsWith("-") && equals > 0 && flags.includes(arg.slice(0, equals)) && arg.length > equals + 1)
      return arg.slice(equals + 1);
  }
  return undefined;
}

function matchesExplicit(value: string, cwd: string, link: NativeSessionLink): boolean {
  if (value === link.providerSessionId) return true;
  if (value && !value.includes("/") && link.providerSessionId.startsWith(value)) return true;
  try {
    return realpathSync(resolve(cwd, value)) === link.path;
  } catch {
    return false;
  }
}

function stat(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
}

/** Gone, or a zombie waiting to be reaped. */
function exited(pid: number): boolean {
  const value = stat(pid);
  if (!value) return !existsSync(`/proc/${pid}`);
  const state = value.slice(value.lastIndexOf(") ") + 2, value.lastIndexOf(") ") + 3);
  return state === "Z" || state === "X";
}

function parent(pid: number): number | undefined {
  const value = stat(pid);
  if (!value) return undefined;
  const fields = value.slice(value.lastIndexOf(") ") + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isSafeInteger(ppid) ? ppid : undefined;
}

/** Providers this Host started are not external owners. */
function descendantOf(pid: number, root: number): boolean {
  let current: number | undefined = pid;
  for (let depth = 0; depth < 64 && current && current > 1; depth++) {
    if (current === root) return true;
    const next = parent(current);
    if (next === current) return false;
    current = next;
  }
  return false;
}

function processes(): { list: Proc[]; uncertain: boolean } | undefined {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  const uid = process.getuid?.();
  const list: Proc[] = [];
  let uncertain = false;
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isSafeInteger(pid) || pid === process.pid) continue;
    try {
      if (statSync(`/proc/${pid}`).uid !== uid) continue;
    } catch {
      continue;
    }
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      list.push({ pid, argv });
    } catch {
      if (!exited(pid)) uncertain = true;
    }
  }
  return { list, uncertain };
}

function access(
  link: NativeSessionLink,
  state: NativeSessionAccess["state"],
  reason: string,
  holder?: Proc,
): NativeSessionAccess {
  return {
    state,
    reason,
    checkedAt: Date.now(),
    path: link.path,
    ...(holder
      ? {
          holder: {
            pid: holder.pid,
            command: holder.argv.join(" ").slice(0, 160),
            provider: link.provider as NativeSessionProvider,
          } satisfies NativeSessionHolder,
        }
      : {}),
  };
}

/** External CLI ownership of one native session, like the desktop probe (Linux only). */
export function nativeProcessAccess(
  link: NativeSessionLink,
  cwd: string,
  root = process.pid,
): NativeSessionAccess {
  if (process.platform !== "linux") return access(link, "unknown", "unsupportedPlatform");
  const result = scanAccess(link, cwd, root);
  // A process starting or exiting mid-scan is usually settled by a second look.
  return result.state === "unknown" && result.reason === "unavailable" ? scanAccess(link, cwd, root) : result;
}

function scanAccess(link: NativeSessionLink, cwd: string, root: number): NativeSessionAccess {
  const scan = processes();
  if (!scan) return access(link, "unknown", "unavailable");
  let uncertain = scan.uncertain;
  let ambiguous: Proc | undefined;
  let sessionCwd = cwd;
  try {
    sessionCwd = realpathSync(cwd);
  } catch {
    /* A moved project still compares by its recorded path. */
  }
  for (const proc of scan.list) {
    if (!providerArgv(proc.argv, link.provider)) continue;
    if (proc.argv.some((arg) => arg === "--no-session" || arg === "--version" || arg === "--help"))
      continue;
    if (descendantOf(proc.pid, root)) continue;
    let procCwd: string | undefined;
    try {
      procCwd = readlinkSync(`/proc/${proc.pid}/cwd`);
    } catch {
      if (!exited(proc.pid)) uncertain = true;
      continue;
    }
    const value = explicitSession(proc.argv, link.provider);
    if (value !== undefined) {
      if (matchesExplicit(value, procCwd, link)) return access(link, "external", "externalProcess", proc);
      continue;
    }
    let otherTranscript = false;
    if (link.storage !== "sqlite") {
      try {
        for (const fd of readdirSync(`/proc/${proc.pid}/fd`)) {
          let target: string;
          try {
            target = readlinkSync(`/proc/${proc.pid}/fd/${fd}`);
          } catch {
            continue;
          }
          if (target === link.path) return access(link, "external", "externalProcess", proc);
          if (target.endsWith(".jsonl")) otherTranscript = true;
        }
      } catch {
        /* Unreadable descriptors fall back to the cwd relation below. */
      }
    }
    if (!otherTranscript && procCwd === sessionCwd) ambiguous ??= proc;
  }
  if (uncertain) return access(link, "unknown", "unavailable");
  if (ambiguous) return access(link, "unknown", "ambiguousProcess", ambiguous);
  return access(link, "idle", "available");
}

/**
 * Probe and guard native sessions for Host turns. `probe` is advisory for
 * clients; `acquire` re-checks under the lock right before a provider write.
 */
export class NativeSessionGuard {
  private cache = new Map<string, { at: number; access: NativeSessionAccess }>();
  constructor(
    /** Directory holding the Host's lock files. */
    private readonly lockDirectory: () => string | undefined,
    private readonly options: { flock?: string; root?: number } = {},
  ) {}

  private lockPaths(link: NativeSessionLink): string[] {
    const directory = this.lockDirectory();
    return directory ? [nativeLockPath(directory, link)] : [];
  }

  private async lease(link: NativeSessionLink): Promise<NativeLease> {
    const paths = this.lockPaths(link);
    if (!paths.length) throw new Error(OWNERSHIP_UNVERIFIED);
    const held: NativeLease[] = [];
    try {
      for (const path of paths) held.push(await acquireNativeLease(path, this.options.flock));
    } catch (error) {
      for (const lease of held.reverse()) await lease.release();
      throw error;
    }
    let releasing: Promise<void> | undefined;
    return {
      release: () => releasing ??= (async () => {
        for (const lease of held.reverse()) await lease.release();
      })(),
    };
  }

  async probe(id: string, link: NativeSessionLink, cwd: string, held = false): Promise<NativeSessionAccess> {
    const cached = this.cache.get(id);
    if (cached && cached.access.path === link.path && Date.now() - cached.at < 2_000) return cached.access;
    let result: NativeSessionAccess;
    if (!this.lockPaths(link).length) result = access(link, "unknown", "unavailable");
    else if (held) result = nativeProcessAccess(link, cwd, this.options.root);
    else {
      try {
        const lease = await this.lease(link);
        // A nonblocking turn must not race the probe's own lock holder exiting.
        await lease.release();
        result = nativeProcessAccess(link, cwd, this.options.root);
      } catch (error) {
        result = access(
          link,
          "unknown",
          error instanceof Error && error.message === IN_USE_BY_OMNICODE ? "anotherOmniCode" : "unavailable",
        );
      }
    }
    this.cache.set(id, { at: Date.now(), access: result });
    return result;
  }

  cached(id: string): NativeSessionAccess | undefined {
    const cached = this.cache.get(id);
    return cached && Date.now() - cached.at < 15_000 ? cached.access : undefined;
  }

  /** Hold the shared locks and confirm no external owner before a provider write. */
  async acquire(id: string, link: NativeSessionLink, cwd: string): Promise<NativeLease> {
    if (process.platform !== "linux") {
      const result = access(link, "unknown", "unsupportedPlatform");
      this.cache.set(id, { at: Date.now(), access: result });
      throw new Error(nativeAccessMessage(result));
    }
    const lease = await this.lease(link);
    const result = nativeProcessAccess(link, cwd, this.options.root);
    this.cache.set(id, { at: Date.now(), access: result });
    if (result.state !== "idle") {
      await lease.release();
      throw new Error(nativeAccessMessage(result));
    }
    return lease;
  }

  forget(id: string): void {
    this.cache.delete(id);
  }
}

const LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "omp",
  opencode: "OpenCode",
};

/** Plain English reason; clients localize their own UI from `access` itself. */
export function nativeAccessMessage(result: NativeSessionAccess): string {
  const holder = result.holder;
  if (holder && result.state === "external")
    return `This conversation is open in ${LABEL[holder.provider] ?? holder.provider} (pid ${holder.pid}). Close it there before continuing here.`;
  if (holder && result.reason === "ambiguousProcess")
    return `${LABEL[holder.provider] ?? holder.provider} is running in this project (pid ${holder.pid}) and may be using this conversation. Close it before continuing here.`;
  if (result.reason === "anotherOmniCode")
    return "OmniCode desktop is using this conversation. Try again when it finishes.";
  if (result.reason === "unsupportedPlatform")
    return "Native session ownership cannot be verified on this platform.";
  return "Native session access could not be confirmed. Check other clients before continuing.";
}
