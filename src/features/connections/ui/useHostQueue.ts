import { translate } from "../../../shared/i18n/language";
import { hostInteractionCapabilities } from "../model/interactionCapabilities";
import { useCallback, useMemo } from "react";
import type {
  CommandReceipt,
  HostCommand,
  HostSession,
} from "../model/protocol";

type QueueCommand = Extract<HostCommand, { type: "queue" }>;
// Shared so an empty queue keeps one identity across renders.
const NO_MESSAGES: NonNullable<HostSession["session"]["queuedMessages"]> = [];
type QueueSnapshot = Pick<HostSession, "status" | "runId" | "canSteer" | "supportsQueue" | "interactionCapabilities" | "queueSteeringId"> & {
  session: Pick<HostSession["session"], "id" | "harness" | "queuedMessages" | "queueStatus" | "editingQueuedMessageId">;
};
/** Queue mutations use the same durable command journal as sends. */
export function useHostQueue(
  snapshot: QueueSnapshot | undefined,
  request: (
    command: QueueCommand,
    transient: boolean,
  ) => Promise<CommandReceipt | undefined>,
  hostCapabilities?: readonly string[],
) {
  const capabilities = hostInteractionCapabilities(snapshot, hostCapabilities);
  const id = snapshot?.session.id;
  const editor = useMemo(() => crypto.randomUUID(), [id]);
  const execute = useCallback(
    async (
      action: QueueCommand["action"],
      fields: Partial<QueueCommand> = {},
    ) => {
      if (!id) throw new Error("Session is not available");
      if (!capabilities.queue) throw new Error(translate("Message queue is unavailable for this conversation."));
      const receipt = await request(
        {
          type: "queue",
          commandId: crypto.randomUUID(),
          sessionId: id,
          action,
          editor,
          ...fields,
        },
        action === "hold" || action === "release",
      );
      if (!receipt) throw new Error("Host has not confirmed the queue change");
    },
    [id, editor, request, capabilities.queue],
  );
  return {
    messages: snapshot?.session.queuedMessages ?? NO_MESSAGES,
    status: snapshot?.session.queueStatus,
    remote: true,
    canSteer:
      capabilities.queue && capabilities.turns.steer &&
      snapshot?.status === "running" &&
      !snapshot?.queueSteeringId,
    canResume: capabilities.queue && snapshot?.status !== "running",
    canReorder: capabilities.queue && !snapshot?.queueSteeringId && !snapshot?.session.editingQueuedMessageId,
    onReorder: useCallback(
      (messageId: string, beforeId?: string) => execute("move", { messageId, beforeId }),
      [execute],
    ),
    onDelete: useCallback(
      (messageId: string) => execute("remove", { messageId }),
      [execute],
    ),
    onSteer: useCallback(
      (messageId: string) =>
        execute("steer", { messageId, runId: snapshot?.runId }),
      [execute, snapshot?.runId],
    ),
    onResume: useCallback(() => execute("resume"), [execute]),
  };
}
