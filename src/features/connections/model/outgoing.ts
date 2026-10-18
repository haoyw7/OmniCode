import type { Attachment, Block } from "../../sessions/model/session";
import type { FollowUpBehavior } from "../../settings/model/settings";
import type { HostSession } from "./protocol";

/** A message on its way to the Host, shown before the Host has recorded it. */
export type OutgoingMessage = {
  /** The Host keeps this id for the recorded transcript message or queue row. */
  id: string;
  text: string;
  attachments?: Attachment[];
  startedAt?: number;
  turnModel?: Block["turnModel"];
  /** Where the message shows until the Host records it. */
  placement: "transcript" | "queue";
};

/**
 * Where the Host will record a send: a busy conversation queues it, unless
 * the running turn can take it as steering now. Mirrors the Host's own rule.
 */
export function outgoingPlacement(
  snapshot: HostSession | undefined,
  followUpBehavior: FollowUpBehavior | undefined,
): OutgoingMessage["placement"] {
  if (!snapshot) return "transcript";
  const { session } = snapshot;
  const nativeHolding =
    session.nativeSession?.mode === "managed" &&
    !!snapshot.nativeStatus &&
    snapshot.nativeStatus.state !== "ready";
  if (snapshot.status !== "running" && !session.queuedMessages?.length && !nativeHolding)
    return "transcript";
  const steers =
    followUpBehavior === "steer" &&
    snapshot.status === "running" &&
    !!snapshot.canSteer &&
    !snapshot.queueSteeringId &&
    !session.editingQueuedMessageId &&
    session.queueStatus !== "paused";
  return steers ? "transcript" : "queue";
}

/** The Host has a copy of the message: in its transcript or its queue. */
export function hostHasMessage(snapshot: HostSession | undefined, id: string): boolean {
  return (
    !!snapshot?.session.blocks.some((block) => block.id === id) ||
    !!snapshot?.session.queuedMessages?.some((row) => row.id === id)
  );
}

/**
 * The conversation as the reader should see it while messages are on their
 * way: a message being steered into the running turn already belongs to the
 * transcript, and an outgoing message shows where the Host will put it. Both
 * stay tinted as sending until the Host has recorded them in the transcript.
 */
export function withOutgoing(
  snapshot: HostSession,
  outgoing?: OutgoingMessage,
): HostSession {
  const { session } = snapshot;
  const steering = snapshot.queueSteeringId
    ? session.queuedMessages?.find((row) => row.id === snapshot.queueSteeringId)
    : undefined;
  const pending = outgoing && !hostHasMessage(snapshot, outgoing.id) ? outgoing : undefined;
  if (!steering && !pending) return snapshot;
  const sending: Block[] = [];
  if (steering)
    sending.push({
      id: steering.id,
      role: "user",
      text: steering.text,
      sending: true,
      ...(steering.attachments.length ? { attachments: steering.attachments } : {}),
    });
  if (pending?.placement === "transcript")
    sending.push({
      id: pending.id,
      role: "user",
      text: pending.text,
      sending: true,
      ...(pending.startedAt != null
        ? { startedAt: pending.startedAt + (snapshot.clockOffsetMs ?? 0) } : {}),
      ...(pending.turnModel ? { turnModel: pending.turnModel } : {}),
      ...(pending.attachments?.length ? { attachments: pending.attachments } : {}),
    });
  const queued = (session.queuedMessages ?? []).filter((row) => row !== steering);
  if (pending?.placement === "queue")
    queued.push({ id: pending.id, text: pending.text, attachments: pending.attachments ?? [] });
  return {
    ...snapshot,
    session: {
      ...session,
      blocks: sending.length ? [...session.blocks, ...sending] : session.blocks,
      queuedMessages: queued.length || session.queuedMessages ? queued : undefined,
    },
  };
}
