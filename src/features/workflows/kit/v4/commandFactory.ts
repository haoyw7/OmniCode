// Monocode shim: ZCode command envelopes, dispatched by the workflow conversation context.
export type CommandEnvelope = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  sessionId: string | null;
};

export function createCommandEnvelope(input: { type: string; payload: Record<string, unknown>; sessionId: string | null; baseRevision?: number }): CommandEnvelope {
  return { commandId: crypto.randomUUID(), type: input.type, payload: input.payload, sessionId: input.sessionId };
}
