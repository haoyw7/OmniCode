import { useCallback, useMemo } from "react";
import type {
  CommandReceipt,
  HostCommand,
  HostSession,
} from "../model/protocol";

type QueueCommand = Extract<HostCommand, { type: "queue" }>;
// Shared so an empty queue keeps one identity across renders.
const NO_MESSAGES: NonNullable<HostSession["session"]["queuedMessages"]> = [];
type QueueSnapshot = Pick<HostSession, "status" | "runId" | "canSteer" | "queueSteeringId"> & {
  session: Pick<HostSession["session"], "id" | "queuedMessages" | "queueStatus" | "editingQueuedMessageId">;
};
/** One edit lease per view. Queue mutations use the same durable command journal
 * as sends; renewable edit leases use ordinary, idempotent RPC requests. */
export function useHostQueue(
  snapshot: QueueSnapshot | undefined,
  request: (
    command: QueueCommand,
    transient: boolean,
  ) => Promise<CommandReceipt | undefined>,
) {
  const id = snapshot?.session.id;
  const editor = useMemo(() => crypto.randomUUID(), [id]);
  const execute = useCallback(
    async (
      action: QueueCommand["action"],
      fields: Partial<QueueCommand> = {},
    ) => {
      if (!id) throw new Error("Session is not available");
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
    [id, editor, request],
  );
  return {
    messages: snapshot?.session.queuedMessages ?? NO_MESSAGES,
    status: snapshot?.session.queueStatus,
    remote: true,
    canSteer:
      !!snapshot?.canSteer &&
      snapshot.status === "running" &&
      !snapshot.queueSteeringId,
    canResume: snapshot?.status !== "running",
    canReorder: !snapshot?.queueSteeringId && !snapshot?.session.editingQueuedMessageId,
    onReorder: useCallback(
      (messageId: string, beforeId?: string) => execute("move", { messageId, beforeId }),
      [execute],
    ),
    onDelete: useCallback(
      (messageId: string) => execute("remove", { messageId }),
      [execute],
    ),
    onEdit: useCallback(
      (messageId: string, text: string) => execute("edit", { messageId, text }),
      [execute],
    ),
    onEditingChange: useCallback(
      (messageId?: string) =>
        execute(messageId ? "hold" : "release", { messageId }),
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
