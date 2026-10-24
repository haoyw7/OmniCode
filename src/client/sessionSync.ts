import type { HostSession, SessionSync, SessionSyncChunk, SessionSyncResponse } from "../contracts/protocol";
import { applySessionSync, sessionClockOffset } from "../domain/sessionSync";
import type { HttpPort } from "./ports";

const MAX_SYNC_LENGTH = 64 * 1024 * 1024;

/** One in-flight transcript read per Host/session, shared by all subscribing panes. */
export class SessionSyncClient<Target> {
  private pending = new Map<string, { revision?: number; request: Promise<SessionSync> }>();

  constructor(private readonly http: HttpPort<Target>, private readonly now = () => Date.now()) {}

  sync(target: Target, sessionId: string, revision?: number, waitMs?: number): Promise<SessionSync> {
    const key = JSON.stringify([this.http.key(target), sessionId]);
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.revision === revision) return pending.request;
      const retry = () => this.sync(target, sessionId, revision, waitMs);
      return pending.request.then(retry, retry);
    }
    const request = this.read(target, sessionId, revision, waitMs).finally(() => {
      if (this.pending.get(key)?.request === request) this.pending.delete(key);
    });
    this.pending.set(key, { revision, request });
    return request;
  }

  async load(target: Target, sessionId: string, known?: HostSession, waitMs?: number): Promise<HostSession> {
    const update = await this.sync(target, sessionId, known?.revision, known ? waitMs : undefined);
    let value: HostSession;
    try { value = applySessionSync(known, update); }
    catch { value = applySessionSync(undefined, await this.sync(target, sessionId)); }
    if (value.session.id !== sessionId) throw new Error("Host returned a different conversation.");
    return value;
  }

  private async read(target: Target, sessionId: string, revision?: number, waitMs?: number): Promise<SessionSync> {
    const sentAt = this.now();
    const result = await this.http.request<SessionSyncResponse>(target, "sessions.sync", {
      sessionId, revision, ...(waitMs ? { waitMs } : {}),
    });
    const clockOffsetMs = sessionClockOffset(result, sentAt, this.now());
    if (result.kind !== "chunked") return { ...result, clockOffsetMs };
    if (!Number.isSafeInteger(result.length) || result.length < 0 || result.length > MAX_SYNC_LENGTH)
      throw new Error("Conversation is too large to load on this device.");
    const pieces: string[] = [];
    let offset = 0;
    while (offset < result.length) {
      const chunk = await this.http.request<SessionSyncChunk>(target, "sessions.syncChunk", {
        sessionId, transfer: result.transfer, offset,
      });
      if (typeof chunk.data !== "string" || !chunk.data || offset + chunk.data.length > result.length)
        throw new Error("Incomplete conversation response.");
      pieces.push(chunk.data);
      offset += chunk.data.length;
    }
    return { ...JSON.parse(pieces.join("")) as SessionSync, clockOffsetMs };
  }
}
