import { createHash } from "node:crypto";
import type { DesktopAppCommand, DesktopAppCommandPoll, DesktopAppCommandResponse } from "../src/contracts/app";

type Lease = { connection: string; windowId: string; sessions: Set<string>; expires: number; generation: number };
type Delivery = { command: DesktopAppCommand; signature: string; owner?: string; response?: DesktopAppCommandResponse; resolve: (response: DesktopAppCommandResponse) => void };
const LEASE_MS = 30_000;

/** Provider execution stays in Host; these leases deliver only desktop presentation. */
export class DesktopAppCommands {
  private readonly leases = new Map<string, Lease>();
  private readonly deliveries = new Map<string, Delivery>();
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private sequence = 0;

  private changed() { for (const listener of [...this.listeners]) listener(); }
  private owner(connection: string, windowId: string) { return JSON.stringify([connection, windowId]); }
  private validWindow(value: unknown): string {
    if (typeof value !== "string" || !value || value.length > 256 || /[\x00-\x1f]/.test(value)) throw new Error("Invalid desktop window ID");
    return value;
  }
  private wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.listeners.delete(finish); resolve(); };
      const timer = setTimeout(finish, milliseconds);
      this.listeners.add(finish);
    });
  }
  private candidates(sourceSessionId: string) {
    const now = Date.now();
    return [...this.leases].filter(([, lease]) => lease.expires > now && lease.sessions.has(sourceSessionId));
  }

  async poll(connection: string, input: Record<string, unknown>, authorize: () => boolean): Promise<DesktopAppCommandPoll> {
    const windowId = this.validWindow(input.windowId);
    if (!Array.isArray(input.sessionIds) || input.sessionIds.length > 500 ||
        input.sessionIds.some(id => typeof id !== "string" || !id || id.length > 256)) throw new Error("Invalid desktop session IDs");
    if (input.waitMs !== undefined && (!Number.isInteger(input.waitMs) || Number(input.waitMs) < 0 || Number(input.waitMs) > 25_000)) throw new Error("Invalid desktop poll timeout");
    if (!authorize() || this.closed) throw new Error("Desktop connection is unavailable");
    const owner = this.owner(connection, windowId), generation = ++this.sequence;
    const lease: Lease = { connection, windowId, sessions: new Set(input.sessionIds as string[]), expires: Date.now() + LEASE_MS, generation };
    this.leases.set(owner, lease);
    this.changed();
    const until = Date.now() + Number(input.waitMs ?? 25_000);
    while (!this.closed && authorize() && this.leases.get(owner)?.generation === generation) {
      const commands: DesktopAppCommand[] = [];
      for (const delivery of this.deliveries.values()) {
        if (delivery.response || !lease.sessions.has(delivery.command.sourceSessionId)) continue;
        if (delivery.owner && this.leases.get(delivery.owner)?.expires! > Date.now() && delivery.owner !== owner) continue;
        delivery.owner = owner;
        commands.push(delivery.command);
        if (commands.length >= 50) break;
      }
      if (commands.length) return { commands };
      const remaining = until - Date.now();
      if (remaining <= 0) break;
      await this.wait(remaining);
    }
    if (!authorize()) { this.leases.delete(owner); throw new Error("Desktop connection is unavailable"); }
    return { commands: [] };
  }

  complete(connection: string, input: Record<string, unknown>): { ok: true } {
    const owner = this.owner(connection, this.validWindow(input.windowId));
    const delivery = this.deliveries.get(String(input.id ?? ""));
    if (!delivery || delivery.owner !== owner || !this.leases.has(owner)) throw new Error("Desktop command does not belong to this window");
    const response = input.response as DesktopAppCommandResponse;
    if (!response || typeof response !== "object" || typeof response.ok !== "boolean" ||
        !response.ok && (typeof response.error !== "string" || response.error.length > 4000)) throw new Error("Invalid desktop command response");
    if (delivery.response && JSON.stringify(delivery.response) !== JSON.stringify(response)) throw new Error("Desktop command response changed");
    if (!delivery.response) {
      delivery.response = response;
      delivery.resolve(response);
    }
    return { ok: true };
  }

  /** New tabs can register their Host ID just after the first provider starts. */
  async available(sourceSessionId: string, authorize: () => boolean, waitMs = 5000): Promise<void> {
    const until = Date.now() + waitMs;
    while (!this.closed && authorize() && !this.candidates(sourceSessionId).length) {
      const remaining = until - Date.now();
      if (remaining <= 0) throw new Error("No connected desktop window can show this conversation");
      await this.wait(remaining);
    }
    if (this.closed || !authorize()) throw new Error("App access is inactive");
  }

  async deliver(command: DesktopAppCommand, authorize: () => boolean): Promise<void> {
    await this.available(command.sourceSessionId, authorize);
    const signature = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    let delivery = this.deliveries.get(command.id);
    if (delivery && delivery.signature !== signature) throw new Error("Desktop command ID was reused with different input");
    if (delivery?.response) {
      if (!delivery.response.ok) throw new Error(delivery.response.error);
      return;
    }
    let resolve!: (response: DesktopAppCommandResponse) => void;
    const response = new Promise<DesktopAppCommandResponse>(done => { resolve = done; });
    delivery = { command, signature, resolve };
    this.deliveries.set(command.id, delivery);
    this.changed();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([response, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Desktop did not confirm this presentation request")), 25_000);
      })]);
      if (!result.ok) throw new Error(result.error);
    } finally {
      clearTimeout(timer);
      if (!delivery.response) this.deliveries.delete(command.id);
      // Completed delivery IDs are also retained by the durable app receipt.
      if (this.deliveries.size > 1000) for (const [id, value] of this.deliveries) {
        if (value.response) this.deliveries.delete(id);
        if (this.deliveries.size <= 500) break;
      }
    }
  }

  close() {
    this.closed = true;
    this.leases.clear();
    for (const delivery of this.deliveries.values()) if (!delivery.response) delivery.resolve({ ok: false, error: "Host is stopping" });
    this.changed();
  }
}
