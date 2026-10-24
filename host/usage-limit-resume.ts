import type { Session, ProviderRateLimits } from "../src/contracts/session";
import { exhaustedWindowResetAt } from "../src/domain/rateLimits";

const GRACE_MS = 30_000;
type Entry = { signature: string; timer?: ReturnType<typeof setTimeout>; nextProbe: number; pending: boolean };

/** Host-owned timers survive client closure; persisted UsageLimit arms restart recovery. */
export class HostUsageLimitResumer {
  private entries = new Map<string, Entry>();
  private closed = false;
  private started = false;
  constructor(private readonly ports: {
    read(id: string): Session | undefined;
    lookup(session: Session): Promise<ProviderRateLimits>;
    setReset(id: string, expected: Session["usageLimit"], resetsAt: number): void;
    resume(id: string, resetsAt: number): Promise<unknown>;
    now?: () => number;
  }) {}

  start(): void { this.started = true; for (const id of this.entries.keys()) this.schedule(id); }

  observe(session: Session): void {
    const id = session.id, old = this.entries.get(id), limit = session.usageLimit;
    if (!limit || this.closed) { if (old?.timer) clearTimeout(old.timer); this.entries.delete(id); return; }
    const signature = JSON.stringify([session.harness, session.providerAccountId, session.busy, limit]);
    if (old?.signature === signature) return;
    if (old?.timer) clearTimeout(old.timer);
    this.entries.set(id, { signature, nextProbe: old?.nextProbe ?? 0, pending: old?.pending ?? false });
    this.schedule(id);
  }

  private now() { return this.ports.now?.() ?? Date.now(); }

  private schedule(id: string): void {
    const entry = this.entries.get(id), session = this.ports.read(id);
    if (!this.started || this.closed || !entry || entry.pending) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (!session?.usageLimit) { this.entries.delete(id); return; }
    const limit = session.usageLimit;
    let delay: number;
    if (limit.resetsAt == null && (session.harness === "codex" || session.harness === "claude")) delay = Math.max(0, entry.nextProbe - this.now());
    else if (limit.resumeAtReset && limit.resetsAt != null) delay = session.busy ? 60_000 : Math.max(0, limit.resetsAt + GRACE_MS - this.now());
    else return;
    entry.timer = setTimeout(() => { entry.timer = undefined; void this.tick(id); }, Math.min(60_000, delay));
    entry.timer.unref();
  }

  private async tick(id: string): Promise<void> {
    const entry = this.entries.get(id), session = this.ports.read(id);
    if (!entry || entry.pending || this.closed || !session?.usageLimit) return;
    const limit = session.usageLimit;
    entry.pending = true;
    let attemptedResume = false;
    try {
      if (limit.resetsAt == null && (session.harness === "codex" || session.harness === "claude")) {
        entry.nextProbe = this.now() + 60_000;
        const limits = await this.ports.lookup(session);
        const reset = exhaustedWindowResetAt(limits);
        if (!this.closed && reset != null) this.ports.setReset(id, limit, reset);
      } else if (!session.busy && limit.resumeAtReset && limit.resetsAt != null && this.now() >= limit.resetsAt + GRACE_MS) {
        // A durable command ID makes a restart during acceptance safe to retry.
        attemptedResume = true;
        await this.ports.resume(id, limit.resetsAt);
      }
    } catch { entry.nextProbe = this.now() + 60_000; }
    finally {
      const current = this.entries.get(id);
      if (current) {
        current.pending = false;
        current.nextProbe = Math.max(current.nextProbe, entry.nextProbe);
        // Admission failures must not spin while a native/managed writer is busy.
        const latest = this.ports.read(id);
        if (attemptedResume && !this.closed && latest?.usageLimit?.resumeAtReset && latest.usageLimit.resetsAt != null &&
            this.now() >= latest.usageLimit.resetsAt + GRACE_MS) {
          current.timer = setTimeout(() => { current.timer = undefined; void this.tick(id); }, 60_000);
          current.timer.unref();
        } else this.schedule(id);
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
  }
}
