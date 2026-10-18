import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, realpathSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import type { HostStore } from "./store";
import { assertMachinePath, currentMachineIO } from "./machine-io";

const resourceListeners = new WeakMap<HostStore, Set<() => void>>();
export function onCheckoutRelease(store: HostStore, listener: () => void): () => void {
  let listeners = resourceListeners.get(store);
  if (!listeners) resourceListeners.set(store, listeners = new Set());
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyCheckoutRelease(store: HostStore): void {
  for (const listener of resourceListeners.get(store) ?? []) listener();
}

/** Shared with the Rust registry through checkout-guards.conformance.json. */
export function checkoutKindsConflict(request: string, held: string): boolean {
  if (request === "computer" || held === "computer") return request === held;
  if (request === "removing" || held === "removing") return true;
  if (request === "resource" || held === "resource") return false;
  return request === "integrating" || held === "integrating";
}

export function checkoutPath(path: string): string {
  const machine = currentMachineIO();
  assertMachinePath(path, machine);
  if (machine.key !== "local") {
    // Remote callers canonicalize paths over MachineIO before reserving them.
    // Encoding the key separates identical Linux paths in different distros.
    return `${encodeURIComponent(machine.key)}:${machine.path.resolve(path)}`;
  }
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  const canonical = existsSync(current)
    ? realpathSync.native(current)
    : current;
  let key = resolve(canonical, ...missing).replace(/\\/g, "/");
  if (/^\/\/\?\/[a-z]:\//i.test(key)) key = key.slice(4);
  return process.platform === "win32" ? key.toLowerCase() : key;
}

export function checkoutPathsOverlap(a: string, b: string): boolean {
  const contains = (left: string, right: string) =>
    left === right || right.startsWith(`${left.replace(/\/$/, "")}/`);
  return contains(a, b) || contains(b, a);
}

export function initCheckoutGuards(store: HostStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS checkout_resources (
    id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, owner_pid INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS checkout_cleanup (
    id TEXT PRIMARY KEY, path TEXT NOT NULL, previous TEXT
  );`);
}

export function checkoutResources(store: HostStore) {
  initCheckoutGuards(store);
  const rows = store.db
    .prepare("SELECT * FROM checkout_resources")
    .all() as unknown as {
    id: string;
    path: string;
    kind: string;
    owner_pid: number;
  }[];
  return rows.filter((row) => {
    if (row.owner_pid <= 0) {
      store.db
        .prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?")
        .run(row.id, row.owner_pid);
      return false;
    }
    try {
      process.kill(row.owner_pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return true;
      if (process.platform !== "win32") {
        try {
          process.kill(-row.owner_pid, 0);
          return true;
        } catch (groupError) {
          if ((groupError as NodeJS.ErrnoException).code !== "ESRCH")
            return true;
        }
      }
      store.db
        .prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?")
        .run(row.id, row.owner_pid);
      return false;
    }
  });
}

/** The identity comes only from a Host-owned run, never from device RPC input. */
const checkoutOwner = new AsyncLocalStorage<{ store: HostStore; owner: string }>();
export function checkoutExecutionPrefix(owner: string): string {
  return `execution:${createHash("sha256").update(owner).digest("hex")}:`;
}
export function withCheckoutOwner<T>(store: HostStore, owner: string, action: () => T): T {
  return checkoutOwner.run({ store, owner }, action);
}

export function assertCheckoutAvailable(store: HostStore, path: string): void {
  const key = checkoutPath(path);
  if (
    checkoutResources(store).some(
      (row) => row.kind === "removing" && checkoutPathsOverlap(key, row.path),
    )
  )
    throw new Error(
      "This working copy is being removed. Wait for cleanup to finish.",
    );
}

/** Recovery waits for the old provider watchdog before capturing partial work. */
export async function waitForProviderDrain(
  store: HostStore,
  path: string,
  timeoutMs = 30_000,
): Promise<void> {
  const key = checkoutPath(path);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pending = checkoutResources(store).some(
      (row) =>
        (row.id.startsWith("host-guard:") ||
          row.id.startsWith("host-provider:")) &&
        checkoutPathsOverlap(key, row.path),
    );
    if (!pending) return;
    if (Date.now() >= deadline)
      throw new Error(
        "A retained provider process is still stopping. Its worker worktree was kept; retry Resume after it exits.",
      );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))),
    );
  }
}

/** Shared with native editors and process launches; never expires a live owner. */
export type CheckoutResourceRelease = (() => void) & {
  transfer(pid: number): void;
};
export function claimCheckoutResource(
  store: HostStore,
  id: string,
  path: string,
): CheckoutResourceRelease {
  return claimResource(store, id, path, "resource");
}

/** An active application mutation excludes an integration on this path. */
export function claimCheckoutWrite(
  store: HostStore,
  id: string,
  path: string,
): CheckoutResourceRelease {
  return claimResource(store, id, path, "writing");
}

function claimResource(
  store: HostStore,
  id: string,
  path: string,
  kind: "resource" | "writing",
): CheckoutResourceRelease {
  const key = checkoutPath(path);
  const context = checkoutOwner.getStore();
  const ownPrefix = context?.store === store ? checkoutExecutionPrefix(context.owner) : undefined;
  if (kind === "writing" && ownPrefix) id = `${ownPrefix}write:${id}`;
  let ownerPid = process.pid;
  store.transaction(() => {
    assertCheckoutAvailable(store, path);
    if (
      kind === "writing" &&
      checkoutResources(store).some(
        (row) =>
          row.kind === "integrating" && checkoutPathsOverlap(key, row.path),
      )
    )
      throw new Error(
        "This working copy is receiving an accepted result. Retry saving after integration finishes.",
      );
    store.db
      .prepare(
        "INSERT INTO checkout_resources VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET path=excluded.path, kind=excluded.kind, owner_pid=excluded.owner_pid",
      )
      .run(id, key, kind, process.pid);
  });
  const release = (() => {
    store.db
      .prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?")
      .run(id, ownerPid);
    notifyCheckoutRelease(store);
  }) as CheckoutResourceRelease;
  release.transfer = (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff)
      throw new Error("Invalid resource process identity");
    const update = store.db
      .prepare(
        "UPDATE checkout_resources SET owner_pid=? WHERE id=? AND owner_pid=?",
      )
      .run(pid, id, ownerPid);
    if (Number(update.changes) !== 1)
      throw new Error(
        "This process no longer owns its working copy reservation",
      );
    ownerPid = pid;
  };
  return release;
}

function occupiedMessage(message: string, rows: ReturnType<typeof checkoutResources>): string {
  return `${message}\n${rows.map(row => `${row.id} · ${row.kind} · PID ${row.owner_pid} · ${row.path}`).join("\n")}`;
}

/** Open buffers can remain mounted; actual writes must finish before apply. */
export async function withCheckoutIntegration<T>(
  store: HostStore,
  paths: string[],
  action: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(paths.map(checkoutPath))];
  const ids = keys.map(() => `integrate:${randomUUID()}`);
  const context = checkoutOwner.getStore();
  const ownPrefix = context?.store === store ? checkoutExecutionPrefix(context.owner) : undefined;
  store.transaction(() => {
    const blockers = checkoutResources(store).filter(row =>
      checkoutKindsConflict("integrating", row.kind) &&
      !(row.kind === "executing" && row.owner_pid === process.pid && ownPrefix && row.id.startsWith(ownPrefix)) &&
      keys.some(key => checkoutPathsOverlap(key, row.path)));
    if (blockers.length) throw new Error(occupiedMessage(
      "This working copy is being changed or removed. Retry accepting the result when the operation finishes.", blockers));
    for (let index = 0; index < keys.length; index++)
      store.db
        .prepare(
          "INSERT INTO checkout_resources VALUES (?, ?, 'integrating', ?)",
        )
        .run(ids[index], keys[index], process.pid);
  });
  try {
    return await action();
  } finally {
    for (const id of ids)
      store.db
        .prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?")
        .run(id, process.pid);
    notifyCheckoutRelease(store);
  }
}

/** Only the reservation row spans asynchronous Git work, never a DB transaction. */
export async function withCheckoutRemoval<T>(
  store: HostStore,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const key = checkoutPath(path);
  const id = `remove:${randomUUID()}`;
  store.transaction(() => {
    const blockers = checkoutResources(store).filter(row => row.kind !== "computer" && checkoutPathsOverlap(key, row.path));
    if (blockers.length) throw new Error(occupiedMessage(
      "Close files and terminals using this worker checkout before cleanup. Its worktree was kept.", blockers));
    store.db
      .prepare("INSERT INTO checkout_resources VALUES (?, ?, 'removing', ?)")
      .run(id, key, process.pid);
  });
  try {
    return await action();
  } finally {
    store.db
      .prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?")
      .run(id, process.pid);
    notifyCheckoutRelease(store);
  }
}
