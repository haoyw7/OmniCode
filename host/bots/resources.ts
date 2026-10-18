import { randomUUID } from "node:crypto";
import type { HostStore } from "../store";
import { currentMachineIO, withMachineIO } from "../machine-io";
import { checkoutKindsConflict, notifyCheckoutRelease, onCheckoutRelease, checkoutExecutionPrefix, checkoutPath, checkoutPathsOverlap, checkoutResources, initCheckoutGuards, withCheckoutOwner } from "../checkout-guards";

import type { ResourceBlocker } from "../../src/features/sessions/model/session";

export type ResourceAcquisition = { acquired: true; ids: readonly string[] } | { acquired: false; blockers: ResourceBlocker[] };

export type HostResourceRequest = { workingDirectory?: string; paths?: string[]; computer?: boolean };
const COMPUTER_RESOURCE = "@host-computer";
export const HOST_RESOURCE_BUSY_MESSAGE = "The requested project or computer is in use by another run. Retry when it finishes.";

export class HostResourceBusyError extends Error {
  readonly code = "RESOURCE_BUSY";
  constructor(readonly blockers: ResourceBlocker[] = []) { super(HOST_RESOURCE_BUSY_MESSAGE); }
}

/**
 * Active turn leases share the native checkout reservation table. Parked provider
 * processes and open editors retain their `resource` rows for removal safety,
 * but do not count as a busy turn. No timeout can evict a live process's lease.
 */
export class HostResourceGuard {
  private held = new Map<string, { signature: string; ids: string[] }>();
  constructor(private readonly store: HostStore) { initCheckoutGuards(store); }

  acquire(owner: string, request: HostResourceRequest): ResourceAcquisition {
    if (!owner) throw new Error("A Host-owned run identity is required");
    const paths = [...new Set([...(request.paths ?? []), ...(request.workingDirectory ? [request.workingDirectory] : [])].map(checkoutPath))].sort();
    const signature = JSON.stringify([paths, !!request.computer]);
    const existing = this.held.get(owner);
    if (existing) {
      if (existing.signature !== signature) throw new Error("A run cannot change its held resource request");
      return { acquired: true, ids: existing.ids };
    }
    const prefix = checkoutExecutionPrefix(owner);
    const claims = paths.map((path) => ({ path, kind: "executing" }));
    if (request.computer) claims.push({ path: COMPUTER_RESOURCE, kind: "computer" });
    const ids = claims.map(() => `${prefix}${randomUUID()}`);
    const result = this.store.transaction<ResourceAcquisition>(() => {
      const rows = checkoutResources(this.store);
      const blockers = rows.filter((row) => !(row.owner_pid === process.pid && row.id.startsWith(prefix)) && (row.kind === "computer"
        ? request.computer
        : checkoutKindsConflict("executing", row.kind) && paths.some((path) => checkoutPathsOverlap(path, row.path))))
        .map(row => ({ id: row.id, kind: row.kind, path: row.path, ownerPid: row.owner_pid }));
      if (blockers.length) return { acquired: false, blockers };
      claims.forEach((claim, index) => this.store.db.prepare("INSERT INTO checkout_resources VALUES (?, ?, ?, ?)").run(ids[index], claim.path, claim.kind, process.pid));
      return { acquired: true, ids };
    });
    if (result.acquired) this.held.set(owner, { signature, ids });
    return result;
  }

  release(owner: string): void {
    const lease = this.held.get(owner);
    if (!lease) return;
    this.held.delete(owner);
    this.store.transaction(() => {
      for (const id of lease.ids)
        this.store.db.prepare("DELETE FROM checkout_resources WHERE id=? AND owner_pid=?").run(id, process.pid);
    });
    notifyCheckoutRelease(this.store);
  }

  close(): void { for (const owner of [...this.held.keys()]) this.release(owner); }
}

/** Short Host-controlled writes join the trusted turn's lease and release only their own rows. */
export async function withHostResources<T>(store: HostStore, owner: string, request: HostResourceRequest, action: () => Promise<T>): Promise<T> {
  const guard = new HostResourceGuard(store);
  const result = guard.acquire(owner, request);
  if (!result.acquired) throw new HostResourceBusyError(result.blockers);
  try { return await withCheckoutOwner(store, owner, action); }
  finally { guard.release(owner); }
}

/** One fallback poll per Host, shared by all cancellable interactive waiters. */
export class HostResourceWaiter {
  private pending = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  constructor(store: HostStore) {
    this.unsubscribe = onCheckoutRelease(store, () => queueMicrotask(() => this.retry()));
  }
  private retry(): void { for (const attempt of [...this.pending]) attempt(); }
  wait(guard: HostResourceGuard, owner: string, request: HostResourceRequest, signal: AbortSignal,
    onBlocked: (blockers: ResourceBlocker[]) => void, timeoutMs = 30_000): Promise<void> {
    const io = currentMachineIO();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let previous = "";
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        this.pending.delete(attempt);
        signal.removeEventListener("abort", abort);
        if (!this.pending.size) { clearInterval(this.timer); this.timer = undefined; }
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new Error("Resource wait cancelled"));
      const attempt = () => withMachineIO(io, () => {
        if (finished) return;
        if (signal.aborted) { abort(); return; }
        try {
          // A deadline is never permission to evict an existing owner.
          if (previous && Date.now() >= deadline) { finish(new HostResourceBusyError(JSON.parse(previous))); return; }
          const result = guard.acquire(owner, request);
          if (result.acquired) { finish(); return; }
          const key = JSON.stringify(result.blockers);
          if (key !== previous) { previous = key; onBlocked(result.blockers); }
        } catch (error) { finish(error); }
      });
      this.pending.add(attempt);
      signal.addEventListener("abort", abort, { once: true });
      this.timer ??= setInterval(() => this.retry(), 1000);
      this.timer.unref?.();
      attempt();
    });
  }
  close(): void {
    this.unsubscribe();
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
