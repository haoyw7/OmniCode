import { motion } from "motion/react";
import { memo, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  MessageQueue,
  type MessageQueueView,
} from "../features/sessions/ui/MessageQueue";
import type { QueuedMessage } from "../features/sessions/model/session";
import { useTranslation } from "../shared/i18n/useTranslation";
import {
  CornerDownRight,
  ListEnd,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "../shared/ui/icons";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import { useQueueDrag } from "./useQueueDrag";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { useListReorderMotion } from "../shared/hooks/useListReorderMotion";

type Props = Omit<ComponentProps<typeof MessageQueue>, "renderQueue"> & {
  onRestore: (message: QueuedMessage) => void | Promise<void>;
  onOverlayChange?: (close?: () => void) => void;
  onReorder?: (messageId: string, beforeId?: string) => void | Promise<void>;
  canReorder?: boolean;
};

// Memoized: the composer re-renders on every keystroke while queued pills
// only change with the session.
export const MobileMessageQueue = memo(function MobileMessageQueue({
  onOverlayChange,
  onRestore,
  onReorder,
  canReorder = true,
  ...props
}: Props) {
  return (
    <MessageQueue
      {...props}
      renderQueue={(view) => (
        <MobileQueueView
          view={view}
          onRestore={onRestore}
          onOverlayChange={onOverlayChange}
          onReorder={onReorder}
          canReorder={canReorder}
        />
      )}
    />
  );
});

function MobileQueueView({
  view,
  onRestore,
  onOverlayChange,
  onReorder,
  canReorder,
}: {
  view: MessageQueueView;
  onRestore: Props["onRestore"];
  onOverlayChange?: Props["onOverlayChange"];
  onReorder?: Props["onReorder"];
  canReorder: boolean;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [menuId, setMenuId] = useState<string>();
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuMessage = view.messages.find((message) => message.id === menuId);
  const blocked = !visible || view.disabled || view.working;
  const sortable =
    !blocked && canReorder && !!onReorder && view.messages.length > 1;
  const sorting = useQueueDrag(
    view.messages.map((message) => message.id),
    sortable,
    (id, beforeId) => {
      view.runAction(async () => {
        try {
          await onReorder?.(id, beforeId);
        } finally {
          sorting.clearPreview();
        }
      });
    },
  );
  const messages = sorting.order
    .map((id) => view.messages.find((message) => message.id === id)!)
    .filter(Boolean);
  useListReorderMotion(list, sorting.order, "data-queue-id", visible);
  const dragged = view.messages.find(
    (message) => message.id === sorting.drag?.id,
  );
  useEffect(() => {
    if (!visible || (!menuMessage && !sorting.drag)) return;
    onOverlayChange?.(() => {
      sorting.cancel();
      setMenuId(undefined);
    });
    return () => onOverlayChange?.();
  }, [visible, !!menuMessage, !!sorting.drag, onOverlayChange]);
  useEffect(() => {
    if (menuId && (!visible || !menuMessage)) setMenuId(undefined);
  }, [visible, menuId, menuMessage]);
  return (
    <>
      <div className="mobile-queue">
        {view.paused && (
          <div className="mobile-queue-paused">
            <Pause size={16} aria-hidden="true" />
            <span>{t("Queue paused")}</span>
            <button
              type="button"
              disabled={blocked || !view.canResume}
              onClick={view.resumeQueue}
            >
              <Play size={16} aria-hidden="true" />
              {t("Resume")}
            </button>
          </div>
        )}
        <div ref={list} className="mobile-queue-pills">
          {messages.map((message) => {
            const label =
              message.text.trim() ||
              t("Queued attachments ({count})", {
                count: message.attachments.length,
              });
            return (
              <button
                type="button"
                key={message.id}
                className="mobile-queue-pill"
                data-queue-id={message.id}
                data-sortable={sortable}
                data-dragging={sorting.drag?.id === message.id}
                disabled={blocked}
                onPointerDown={(event) => sorting.start(message.id, event)}
                onContextMenu={(event) => {
                  if (sortable) event.preventDefault();
                }}
                aria-label={t("Queued message actions")}
                aria-haspopup="dialog"
                aria-expanded={menuId === message.id}
                title={label}
                onClick={(event) => {
                  if (sorting.suppressClick()) {
                    event.preventDefault();
                    return;
                  }
                  anchor.current = event.currentTarget;
                  setMenuId(message.id);
                }}
              >
                <ListEnd size={17} aria-hidden="true" />
                {message.origin?.kind === "assistant" && <small>{t("From {value0}", { value0: message.origin.assistantName || t("Assistant") })}</small>}
                {message.blocked && <small title={t(message.blocked)}>{t("Blocked")}</small>}
                <span>{label}</span>
                <MoreHorizontal size={20} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {view.error && (
          <p className="mobile-queue-error" role="alert">
            {view.error}
          </p>
        )}
      </div>
      {sorting.drag && dragged && (
        <motion.div
          layout="position"
          ref={sorting.previewRef}
          className="mobile-queue-pill mobile-queue-drag-preview"
          aria-hidden="true"
          // The pill follows the finger on the compositor: moving `top` would
          // re-lay out and re-blur the glass on every frame.
          style={{
            left: sorting.drag.left,
            top: 0,
            width: sorting.drag.width,
            ...sorting.previewStyle,
          }}
        >
          <ListEnd size={17} />
          <span>
            {dragged.text.trim() ||
              t("Queued attachments ({count})", {
                count: dragged.attachments.length,
              })}
          </span>
          <MoreHorizontal size={20} />
        </motion.div>
      )}
      <MobileSheetPresence open={visible && !!menuMessage}>
      {menuMessage ? (
        <MobileSheet
          title="Queued message actions"
          placement="anchor"
          anchor={anchor}
          side="top"
          align="end"
          width={SHEET_WIDTH.menu}
          onClose={() => setMenuId(undefined)}
        >
          <button
            type="button"
            className="mobile-sheet-row"
            disabled={blocked || !view.canDelete}
            onClick={() => {
              view.runAction(() => onRestore(menuMessage));
              setMenuId(undefined);
            }}
          >
            <Pencil size={21} />
            <span>{t("Edit message")}</span>
          </button>
          <button
            type="button"
            className="mobile-sheet-row"
            disabled={blocked || !!menuMessage.blocked || !view.canSteer}
            onClick={() => {
              view.steerMessage(menuMessage.id);
              setMenuId(undefined);
            }}
          >
            <CornerDownRight size={21} />
            <span>{t("Use as steering")}</span>
          </button>
          <button
            type="button"
            className="mobile-sheet-row mobile-queue-remove"
            disabled={blocked || !view.canDelete}
            onClick={() => {
              view.deleteMessage(menuMessage.id);
              setMenuId(undefined);
            }}
          >
            <Trash2 size={21} />
            <span>{t("Cancel message send")}</span>
          </button>
        </MobileSheet>
      ) : null}
      </MobileSheetPresence>
    </>
  );
}
