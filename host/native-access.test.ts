import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IN_USE_BY_MONOCODE,
  acquireNativeLease,
  explicitSession,
  nativeLockPath,
  nativeProcessAccess,
  providerArgv,
  NativeSessionGuard,
} from "./native-access";
import type { NativeSessionLink } from "../src/features/sessions/model/session";

const linux = process.platform === "linux";
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function temp() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "monocode-native-access-")));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const link = (path: string, extra: Partial<NativeSessionLink> = {}): NativeSessionLink => ({
  provider: "claude",
  providerSessionId: "sess-1",
  path,
  revision: "1",
  blockIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}
/** A fake CLI binary named like the provider, idling until killed. */
function fakeCli(directory: string, name: string, args: string[], cwd: string): Promise<ChildProcess> {
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  const path = join(bin, name);
  writeFileSync(path, "#!/usr/bin/env node\nconsole.log('ready'); setInterval(() => {}, 1000);\n");
  chmodSync(path, 0o755);
  const child = spawn(path, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
  cleanups.push(() => stopChild(child));
  return new Promise((resolve) => child.stdout!.once("data", () => resolve(child)));
}

describe("native session lock interop", () => {
  it("uses the desktop's lock file name for files and per-conversation database keys", () => {
    const hex = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(nativeLockPath("/data", link("/s/a.jsonl"))).toBe(`/data/native-session-locks/${hex("/s/a.jsonl")}.lock`);
    expect(nativeLockPath("/data", link("/o/opencode.db", { storage: "sqlite", providerSessionId: "ses_1" }))).toBe(
      `/data/native-session-locks/${hex("/o/opencode.db#ses_1")}.lock`,
    );
  });

  it.runIf(linux)("serializes writers through flock and releases on demand", async () => {
    const lock = join(temp(), "locks", "x.lock");
    const first = await acquireNativeLease(lock);
    await expect(acquireNativeLease(lock)).rejects.toThrow(IN_USE_BY_MONOCODE);
    await first.release();
    const second = await acquireNativeLease(lock);
    await second.release();
  });

  it.runIf(linux)("waits for a probe's own lock holder to exit before permitting a turn", async () => {
    const directory = temp();
    const delayedFlock = join(directory, "delayed-flock");
    // Real flock, with a slower command exit to make the release race repeatable.
    writeFileSync(delayedFlock, `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
args[args.length - 1] = args.at(-1).replace("exec cat", "cat; sleep 0.15");
const child = spawn("flock", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
`);
    chmodSync(delayedFlock, 0o755);
    const session = link(join(directory, "session.jsonl"), { providerSessionId: randomUUID() });
    const guard = new NativeSessionGuard(() => directory, { flock: delayedFlock });
    expect(await guard.probe("probe", session, directory)).toMatchObject({ state: "idle" });
    const turn = await guard.acquire("probe", session, directory);
    await turn.release();
  });

  it.runIf(linux)("sees a lock held by any flock(2) holder, as the desktop takes it", async () => {
    const lock = join(temp(), "y.lock");
    const holder = spawn("flock", [lock, "-c", "echo held; exec cat"], { stdio: ["pipe", "pipe", "ignore"] });
    cleanups.push(() => new Promise<void>((resolve) => {
      if (holder.exitCode !== null || holder.signalCode !== null) {
        resolve();
        return;
      }
      holder.once("exit", () => resolve());
      holder.stdin!.end();
    }));
    await new Promise((resolve) => holder.stdout!.once("data", resolve));
    await expect(acquireNativeLease(lock)).rejects.toThrow(IN_USE_BY_MONOCODE);
  });
});

describe("external CLI detection", () => {
  it("recognizes provider binaries and session flags", () => {
    expect(providerArgv(["/home/u/.local/share/claude/versions/2.1.289", "-r", "x"], "claude")).toBe(true);
    expect(providerArgv(["omp"], "pi")).toBe(false);
    expect(explicitSession(["claude", "--resume", "id-1"], "claude")).toBe("id-1");
    expect(explicitSession(["claude", "-r"], "claude")).toBeUndefined();
    expect(explicitSession(["opencode", "-s", "ses_1"], "opencode")).toBe("ses_1");
    expect(explicitSession(["claude", "--model=opus"], "claude")).toBeUndefined();
  });

  it.runIf(linux)("reports an explicit external holder and ignores other sessions", async () => {
    const directory = temp();
    const session = link(join(directory, "sess-1.jsonl"));
    // root -1: the test process itself is not the Host that would own these children.
    expect(nativeProcessAccess(session, directory, -1).state).toBe("idle");
    const owner = await fakeCli(directory, "claude", ["--resume", "sess-1"], directory);
    const access = nativeProcessAccess(session, directory, -1);
    expect(access).toMatchObject({ state: "external", holder: { pid: owner.pid, provider: "claude" } });
    // Children of the Host itself are its own providers, not external owners.
    expect(nativeProcessAccess(session, directory).state).toBe("idle");
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("exit", resolve));
    await fakeCli(directory, "claude", ["--resume", "other-session"], directory);
    expect(nativeProcessAccess(session, directory, -1).state).toBe("idle");
  });

  it.runIf(linux)("treats an unbound CLI in the same project as a possible owner", async () => {
    const directory = temp();
    const session = link(join(directory, "sess-1.jsonl"));
    const owner = await fakeCli(directory, "claude", [], directory);
    expect(nativeProcessAccess(session, directory, -1)).toMatchObject({
      state: "unknown",
      reason: "ambiguousProcess",
      holder: { pid: owner.pid },
    });
  });
});
