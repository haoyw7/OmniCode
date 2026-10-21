import { createStore } from "zustand/vanilla";
export type TranscriptJump = { blockId: string; query?: string; token: number };

const jumps = createStore(() => ({ pending: new Map<string, TranscriptJump>(), nextToken: 0 }));

export function requestTranscriptJump(
  sessionId: string,
  blockId: string,
  query?: string,
): void {
  jumps.setState(state => {
    const nextToken = state.nextToken + 1;
    return { pending: new Map(state.pending).set(sessionId, { blockId, query, token: nextToken }), nextToken };
  });
}

export function peekTranscriptJump(sessionId: string): TranscriptJump | null {
  return jumps.getState().pending.get(sessionId) ?? null;
}

export function clearTranscriptJump(sessionId: string, token: number): void {
  jumps.setState(state => {
    if (state.pending.get(sessionId)?.token !== token) return state;
    const pending = new Map(state.pending);
    pending.delete(sessionId);
    return { pending };
  });
}

export function subscribeTranscriptJump(listener: () => void): () => void {
  return jumps.subscribe(listener);
}
