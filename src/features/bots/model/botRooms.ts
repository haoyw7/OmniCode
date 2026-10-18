export type BotRoom = {
  id: string; name: string; memberIds: string[]; memberTimeoutMs: number;
  /** Configuration CAS revision; activity does not invalidate an editor. */
  revision: number; chatRevision: number; activityRevision: number;
  createdAt: number; updatedAt: number; archivedAt?: number;
};
export type BotRoomSpeakerStatus = "pending" | "queued" | "running" | "waiting_approval" | "completed" | "failed" | "timed_out" | "cancelled" | "interrupted";
export type BotRoomSpeaker = {
  botId: string; threadId?: string; runId?: string;
  status: BotRoomSpeakerStatus; startedAt?: number; deadlineAt?: number; completedAt?: number;
  result?: string; resultTruncated?: boolean; error?: string;
};
export type BotRoomRound = {
  id: string; roomId: string; userMessageId: string;
  status: "queued" | "running" | "completed" | "cancelled" | "interrupted";
  /** Explicit send order; omitted means use the room's order when the round starts. */
  requestedMemberIds?: string[];
  roomRevision: number; memberTimeoutMs: number; speakers: BotRoomSpeaker[];
  createdAt: number; updatedAt: number; startedAt?: number; completedAt?: number;
};
export type BotRoomMessage = {
  id: string; roomId: string; roundId: string; sequence: number;
  kind: "user" | "assistant" | "status"; text: string; createdAt: number;
  botId?: string; threadId?: string; runId?: string; status?: BotRoomSpeakerStatus;
};
export type BotRoomCursor = { sequence: number; id: string };
export type BotRoomMessages = {
  revision: number; messages: BotRoomMessage[]; hasMore: boolean; next?: BotRoomCursor;
};
export type BotRooms = { revision: number; rooms: BotRoom[] };
/** Last 50 rounds, newest first; includes all queued/running rounds (queue limit 20). */
export type BotRoomState = { room: BotRoom; rounds: BotRoomRound[] };
