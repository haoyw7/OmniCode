import { isPreparingHandoff } from "./handoff";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import type { Block, QueuedMessage, QueueReturnPosition, Session } from "./session";

export function lastQueueUserMessageId(blocks: readonly Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user" && !block.draft) return block.id;
  }
}

export function captureQueueReturnPosition(
  messages: readonly QueuedMessage[],
  messageId: string,
  lastUserMessageId?: string,
): QueueReturnPosition | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return undefined;
  return {
    precedingIds: messages.slice(0, index).map((message) => message.id),
    followingIds: messages.slice(index + 1).map((message) => message.id),
    ...(lastUserMessageId ? { lastUserMessageId } : {}),
  };
}

export function insertQueuedMessage(
  session: Pick<Session, "queuedMessages" | "blocks">,
  message: QueuedMessage,
  position?: QueueReturnPosition,
  steeringId?: string,
): QueuedMessage[] {
  const messages = session.queuedMessages ?? [];
  if (!position) return [...messages, message];
  const preceding = new Set(position.precedingIds);
  const following = new Set(position.followingIds);
  let foundTurn = !position.lastUserMessageId;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role !== "user" || block.draft) continue;
    if (block.id === position.lastUserMessageId) { foundTurn = true; break; }
    if (following.has(block.id) ||
        (!preceding.has(block.id) && (block.startedAt !== undefined || block.sentAt === undefined)))
      return [...messages, message];
  }
  if (!foundTurn || (steeringId && following.has(steeringId))) return [...messages, message];
  let index = messages.findIndex((row) => following.has(row.id));
  if (index < 0) {
    index = 0;
    for (let at = messages.length - 1; at >= 0; at--) {
      if (preceding.has(messages[at].id)) { index = at + 1; break; }
    }
  }
  const next = [...messages];
  next.splice(index, 0, message);
  return next;
}

export function queuedHead(session: Session): QueuedMessage | undefined {
  return session.queuedMessages?.find(message => !message.blocked);
}

/** Hold auto-dispatch only while the item about to send is being edited. */
export function isEditingQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return Boolean(head && session.editingQueuedMessageId === head.id);
}

export function dequeueQueuedMessage(
  session: Session,
  messageId: string,
): Session {
  const queuedMessages = (session.queuedMessages ?? []).filter(
    (message) => message.id !== messageId,
  );
  return {
    ...session,
    queuedMessages: queuedMessages.length > 0 ? queuedMessages : undefined,
    queueStatus: queuedMessages.length > 0 ? session.queueStatus : undefined,
    editingQueuedMessageId:
      session.editingQueuedMessageId === messageId
        ? undefined
        : session.editingQueuedMessageId,
  };
}

export function moveQueuedMessage(session: Session, messageId: string, beforeId?: string): Session {
  const messages = session.queuedMessages;
  const message = messages?.find((row) => row.id === messageId);
  if (!messages || !message || messageId === beforeId || session.editingQueuedMessageId) return session;
  const remaining = messages.filter((row) => row.id !== messageId);
  const index = beforeId ? remaining.findIndex((row) => row.id === beforeId) : remaining.length;
  if (index < 0) return session;
  remaining.splice(index, 0, message);
  if (remaining.every((row, at) => row === messages[at])) return session;
  return { ...session, queuedMessages: remaining };
}

/**
 * True when the idle session can send its queued head as a new turn.
 * Busy / paused / resuming / usage-limited / preparing-handoff /
 * editing-the-head all wait.
 */
export function canDispatchQueuedHead(session: Session): boolean {
  // A desktop tab observes the Host queue. Only the Host's session (with its
  // absolute execution path) can dispatch it, even between two sync polls.
  if (session.cwd.startsWith(REMOTE_PATH_PREFIX)) return false;
  if (session.busy) return false;
  if (session.usageLimit) return false;
  if (session.queueStatus === "paused" || session.queueStatus === "resuming") {
    return false;
  }
  const head = queuedHead(session);
  if (!head) return false;
  if (isEditingQueuedHead(session)) return false;
  if (isPreparingHandoff(session)) return false;
  return true;
}

/** Resolve a queued row for auto-dispatch (head, idle) or an explicit Steer. */
export function queuedMessageForSubmit(
  session: Session,
  messageId: string,
  mode: "dispatch" | "steer",
): QueuedMessage | undefined {
  const message = session.queuedMessages?.find(
    (entry) => entry.id === messageId,
  );
  if (!message || message.blocked) return undefined;
  if (mode === "steer") return message;
  if (queuedHead(session)?.id !== messageId) return undefined;
  if (!canDispatchQueuedHead(session)) return undefined;
  return message;
}
