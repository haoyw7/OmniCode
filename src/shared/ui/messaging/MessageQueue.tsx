import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { useListReorderMotion } from "../../../shared/hooks/useListReorderMotion";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { orderByIds } from "../../../shared/lib/reorder";
import { CornerDownRight, GripVertical, ListEnd, Pause, Pencil, Play, Trash2 } from "../../../shared/ui/icons";
import type { QueuedMessage, MessageQueueStatus } from "../../../contracts/session";

/** Alternate presentations reuse the queue's mutation and error handling. */
export type MessageQueueView = {
  messages: QueuedMessage[];
  paused: boolean;
  disabled: boolean;
  working: boolean;
  error: string;
  canDelete: boolean;
  canSteer: boolean;
  canResume: boolean;
  runAction: (action: () => void | Promise<void>) => void;
  deleteMessage: (messageId: string) => void;
  steerMessage: (messageId: string) => void;
  resumeQueue: () => void;
};

type Props = {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  onDelete?: (messageId: string) => void | Promise<void>;
  onRestore?: (message: QueuedMessage) => void | Promise<void>;
  onReorder?: (messageId: string, beforeId?: string) => void | Promise<void>;
  onSteer?: (messageId: string) => void | Promise<void>;
  onResume?: () => void | Promise<void>;
  disabled?: boolean;
  canReorder?: boolean;
  canSteer?: boolean;
  canResume?: boolean;
  remote?: boolean;
  renderQueue?: (view: MessageQueueView) => ReactNode;
};

export function MessageQueue({
  messages,
  status,
  onDelete,
  onSteer,
  onResume,
  disabled = false,
  canSteer = true,
  canResume = true,
  renderQueue,
  ...props
}: Props) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const [error, setError] = useState("");
  const invoke = (action: (() => void | Promise<void>) | undefined) => {
    if (!action || workingRef.current || disabled) return;
    setError("");
    try {
      const result = action();
      if (result && typeof result.then === "function") {
        workingRef.current = true;
        setWorking(true);
        void result
          .catch((reason) =>
            setError(t(String(reason).replace(/^Error: /, ""))),
          )
          .finally(() => {
            workingRef.current = false;
            setWorking(false);
          });
      }
    } catch (reason) {
      setError(t(String(reason).replace(/^Error: /, "")));
    }
  };
  if (messages.length === 0) return null;
  const view: MessageQueueView = {
    messages,
    paused: status === "paused",
    disabled,
    working,
    error,
    canDelete: !!onDelete,
    canSteer: canSteer && !!onSteer,
    canResume: canResume && !!onResume,
    runAction: invoke,
    deleteMessage: (id) => invoke(() => onDelete?.(id)),
    steerMessage: (id) => invoke(() => onSteer?.(id)),
    resumeQueue: () => invoke(onResume),
  };
  return renderQueue ? (
    renderQueue(view)
  ) : (
    <DesktopMessageQueue view={view} {...props} />
  );
}

function DesktopMessageQueue({
  view,
  onRestore,
  onReorder,
  canReorder = true,
  remote,
}: Pick<Props, "onRestore" | "onReorder" | "canReorder" | "remote"> & {
  view: MessageQueueView;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const [pendingOrder, setPendingOrder] = useState<string[]>();
  const reorderBaseline = useRef("");
  const manualReorder = useRef(false);
  const snapshotOrder = view.messages.map((message) => message.id).join("\0");
  useEffect(() => {
    if (pendingOrder && snapshotOrder !== reorderBaseline.current)
      setPendingOrder(undefined);
  }, [pendingOrder, snapshotOrder]);
  const messages = pendingOrder
    ? orderByIds(view.messages, pendingOrder)
    : view.messages;
  const ids = messages.map((message) => message.id);
  const blocked = view.disabled || view.working || !!pendingOrder;
  const sortable = !blocked && canReorder && !!onReorder && ids.length > 1;
  const reorder = (order: string[], id: string) => {
    view.runAction(async () => {
      reorderBaseline.current = snapshotOrder;
      setPendingOrder(order);
      try {
        await onReorder?.(id, order[order.indexOf(id) + 1]);
        if (!remote) setPendingOrder(undefined);
      } catch (reason) {
        setPendingOrder(undefined);
        throw reason;
      }
    });
  };
  const sorting = useAnimatedReorder(
    sortable ? ids : [],
    (order, id) => {
      manualReorder.current = true;
      reorder(order, id);
    },
    "y",
  );
  useListReorderMotion(
    list,
    ids,
    "data-queue-id",
    !sorting.draggingId && !(manualReorder.current && pendingOrder),
  );

  return (
    <div className="px-2 text-content/55" data-message-queue>
      <div
        className="relative z-0 mb-1.5 rounded-[10px] border border-content/10 bg-content/3 px-2 py-0.5"
        data-message-queue-card
      >
        {view.paused && (
          <div className="flex h-6 items-center gap-2 border-b border-stroke text-[12px]">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {t(
                remote
                  ? "Queue paused"
                  : "Queue paused because you interrupted",
              )}
            </span>
            <button
              type="button"
              disabled={blocked || !view.canResume}
              onClick={view.resumeQueue}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/6 hover:text-content"
            >
              <Play className="size-3.5" />
              {t("Resume")}
            </button>
          </div>
        )}
        {view.error && (
          <p role="alert" className="py-1 text-[12px] text-danger">
            {view.error}
          </p>
        )}
        <div ref={list}>
          {messages.map((message, index) => (
            <div
              key={message.id}
              ref={(node) => sorting.setItemRef(message.id, node)}
              data-queue-id={message.id}
              className={`relative flex min-h-6 items-center gap-2 text-[12px] data-[dragging=true]:z-10 data-[dragging=true]:bg-content/6 ${index > 0 ? "border-t border-stroke" : ""}`}
            >
              {onReorder && messages.length > 1 ? (
                <button
                  type="button"
                  title={t("Drag to reorder queued message")}
                  aria-label={t("Drag to reorder queued message")}
                  disabled={!sortable}
                  onPointerDown={(event) =>
                    sorting.onItemPointerDown(message.id, event)
                  }
                  onClick={(event) => {
                    if (sorting.consumeClick()) event.preventDefault();
                  }}
                  onKeyDown={(event) => {
                    if (
                      !sortable ||
                      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    )
                      return;
                    event.preventDefault();
                    const to = index + (event.key === "ArrowUp" ? -1 : 1);
                    if (to < 0 || to >= ids.length) return;
                    const order = ids.filter((id) => id !== message.id);
                    order.splice(to, 0, message.id);
                    manualReorder.current = false;
                    reorder(order, message.id);
                  }}
                  className="grid size-6 shrink-0 touch-none cursor-grab place-items-center rounded-md hover:bg-content/6 hover:text-content active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                >
                  <GripVertical className="size-3.5" />
                </button>
              ) : (
                <ListEnd className="size-3.5 shrink-0" />
              )}
              {message.origin?.kind === "assistant" && (
                <span className="shrink-0 text-xs text-content/60">
                  {t("From {value0}", {
                    value0: message.origin.assistantName || t("Assistant"),
                  })}
                </span>
              )}
              {message.blocked && (
                <span
                  className="shrink-0 text-xs text-red-400"
                  title={t(message.blocked)}
                >
                  {t("Blocked")}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-content/80">
                {message.text.trim() ||
                  t("Queued attachments ({count})", {
                    count: message.attachments.length,
                  })}
              </span>
              <button
                type="button"
                disabled={blocked || !!message.blocked || !view.canSteer}
                onClick={() => view.steerMessage(message.id)}
                className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/6 hover:text-content"
              >
                <CornerDownRight className="size-3.5" />
                {t("Steer")}
              </button>
              <button
                type="button"
                title={t("Edit queued message")}
                aria-label={t("Edit queued message")}
                disabled={blocked || !onRestore}
                onClick={() => view.runAction(() => onRestore?.(message))}
                className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/6 hover:text-content"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("Remove queued message")}
                aria-label={t("Remove queued message")}
                disabled={blocked || !view.canDelete}
                onClick={() => view.deleteMessage(message.id)}
                className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/6 hover:text-content"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
