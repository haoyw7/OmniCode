import { motion } from "motion/react";
import { memo, useContext, useEffect, useRef, useState, type ComponentProps } from "react";
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
import { SortableItem, SortableList } from "../shared/ui/primitives/Sortable";
import { orderByIds } from "../shared/lib/reorder";
import { lightImpact } from "./haptics";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { MobileOverlayHostContext } from "./MobileOverlayHost";

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
  const overlayContainer = useContext(MobileOverlayHostContext);
  const [menuId, setMenuId] = useState<string>();
  const anchor = useRef<HTMLButtonElement>(null);
  const [pendingOrder, setPendingOrder] = useState<string[]>();
  const [dragging, setDragging] = useState(false);
  const cancelDrag = useRef<(() => void) | undefined>(undefined);
  const menuMessage = view.messages.find((message) => message.id === menuId);
  const blocked = !visible || view.disabled || view.working || !!pendingOrder;
  const sortable =
    !blocked && canReorder && !!onReorder && view.messages.length > 1;
  const reorder = (ids: string[], id: string) => {
      view.runAction(async () => {
        setPendingOrder(ids);
        try {
          await onReorder?.(id, ids[ids.indexOf(id) + 1]);
        } finally {
          setPendingOrder(undefined);
        }
      });
  };
  const messages = pendingOrder ? orderByIds(view.messages, pendingOrder) : view.messages;
  useEffect(() => {
    if (!visible || (!menuMessage && !dragging)) return;
    onOverlayChange?.(() => {
      cancelDrag.current?.();
      setMenuId(undefined);
    });
    return () => onOverlayChange?.();
  }, [visible, !!menuMessage, dragging, onOverlayChange]);
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
        <div className="mobile-queue-pills">
          <SortableList touch ids={messages.map(message => message.id)} disabled={!sortable} onReorder={reorder} cancelRef={cancelDrag}
            overlayContainer={overlayContainer} overlayClassName="mobile-queue-pill"
            onActiveChange={(active) => { setDragging(active); if (active) setMenuId(undefined); void lightImpact(); }}
            renderOverlay={(id) => {
              const message = messages.find(message => message.id === id)!;
              return <><ListEnd size={16} /><span>{message.text.trim() || t("Queued attachments ({count})", { count: message.attachments.length })}</span><MoreHorizontal size={16} /></>;
            }}>
          {messages.map((message) => {
            const label =
              message.text.trim() ||
              t("Queued attachments ({count})", {
                count: message.attachments.length,
              });
            return (
              <SortableItem id={message.id} key={message.id} disabled={!sortable}>{(item) => <motion.button
                {...item.motionProps}
                {...item.handleProps}
                ref={(node) => { item.ref(node); item.handleProps.ref(node); }}
                style={item.style}
                type="button"
                key={message.id}
                className="mobile-queue-pill"
                data-queue-id={message.id}
                data-sortable={sortable}
                data-dragging={item.dragging}
                disabled={blocked}
                onContextMenu={(event) => {
                  if (sortable) event.preventDefault();
                }}
                aria-label={t("Queued message actions")}
                aria-haspopup="dialog"
                aria-expanded={menuId === message.id}
                title={label}
                onClick={(event) => {
                  if (item.consumeClick()) {
                    event.preventDefault();
                    return;
                  }
                  anchor.current = event.currentTarget;
                  setMenuId(message.id);
                }}
              >
                <ListEnd size={16} aria-hidden="true" />
                {message.origin?.kind === "assistant" && <small>{t("From {value0}", { value0: message.origin.assistantName || t("Assistant") })}</small>}
                {message.blocked && <small title={t(message.blocked)}>{t("Blocked")}</small>}
                <span>{label}</span>
                <MoreHorizontal size={16} aria-hidden="true" />
              </motion.button>}</SortableItem>
            );
          })}
          </SortableList>
        </div>
        {view.error && (
          <p className="mobile-queue-error" role="alert">
            {view.error}
          </p>
        )}
      </div>
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
            <Pencil size={20} />
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
            <CornerDownRight size={20} />
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
            <Trash2 size={20} />
            <span>{t("Cancel message send")}</span>
          </button>
        </MobileSheet>
      ) : null}
      </MobileSheetPresence>
    </>
  );
}
