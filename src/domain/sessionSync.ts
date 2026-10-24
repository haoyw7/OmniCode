import type { HostSession, SessionSync, SessionSyncResponse } from "../contracts/protocol";

const CLOCK_OFFSET_TOLERANCE_MS = 1_000;

export function sessionClockOffset(response: SessionSyncResponse, sentAt: number, receivedAt: number): number | undefined {
  const waited = typeof response.serverWaitMs === "number" && Number.isFinite(response.serverWaitMs)
    ? Math.max(0, Math.min(receivedAt - sentAt, response.serverWaitMs)) : 0;
  return typeof response.serverTime === "number" && Number.isFinite(response.serverTime)
    ? response.serverTime - (sentAt + receivedAt + waited) / 2 : undefined;
}

/** Reject a delta that cannot be applied so callers can request a full snapshot. */
export function applySessionSync(known: HostSession | undefined, sync: SessionSync): HostSession {
  const result = mergeSessionSync(known, sync);
  const previous = known?.clockOffsetMs;
  const measured = sync.clockOffsetMs;
  const offset = measured == null || (previous != null && Math.abs(measured - previous) < CLOCK_OFFSET_TOLERANCE_MS)
    ? previous : measured;
  return offset == null || result.clockOffsetMs === offset ? result : { ...result, clockOffsetMs: offset };
}

export function mergeSessionSync(known: HostSession | undefined, sync: SessionSync): HostSession {
  if (sync.kind === "snapshot") return sync.value;
  if (!known || known.revision !== (sync.kind === "delta" ? sync.base : sync.revision))
    throw new Error("Session sync base does not match");
  if (sync.kind === "unchanged") return known;
  const blocks = new Map(known.session.blocks.map(block => [block.id, block]));
  for (const block of sync.blocks) blocks.set(block.id, block);
  return {
    ...sync.value,
    session: {
      ...sync.value.session,
      blocks: sync.blockIds.map(id => {
        const block = blocks.get(id);
        if (!block) throw new Error("Session sync is missing a block");
        return block;
      }),
    },
  };
}
