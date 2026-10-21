export const HISTORY_CAPABILITY = "sessions.history.v1";
export const HISTORY_MODE = "tail-v1";
export type HistoryRequest = { mode: typeof HISTORY_MODE; start?: string; before?: string };
export type HistoryWindow = { mode: typeof HISTORY_MODE; start?: string; hasMore: boolean };
export type TranscriptHistory = { hasMore: boolean; loadEarlier(beforeCommit?: () => void): Promise<void> };
