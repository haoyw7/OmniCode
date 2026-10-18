import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";

const interactive = (target: EventTarget) =>
  target instanceof Element &&
  !!target.closest("a, button, input, textarea, select");

/** Touch movement cancels the hold so reading/scrolling never opens a menu. */
export function useBotReplyMenu(mobile: boolean, active: boolean) {
  const [menu, setMenu] = useState<{
    x: number; y: number; text: string; replyable: boolean;
  }>();
  const hold = useRef<
    { x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  const cancelHold = useCallback(() => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = undefined;
  }, []);
  const close = useCallback(() => {
    cancelHold();
    setMenu(undefined);
  }, [cancelHold]);
  useEffect(() => {
    if (!active) close();
    return cancelHold;
  }, [active, close, cancelHold]);
  const bind = useCallback((text: string, replyable = true): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: 0,
    "aria-haspopup": mobile ? "dialog" : "menu",
    onContextMenu: (event) => {
      if (!active || event.defaultPrevented || interactive(event.target))
        return;
      event.preventDefault();
      event.stopPropagation();
      cancelHold();
      setMenu({ x: event.clientX, y: event.clientY, text, replyable });
    },
    onKeyDown: (event) => {
      if (!active || interactive(event.target)) return;
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left, y: rect.bottom, text, replyable });
      }
    },
    onPointerDown: (event) => {
      cancelHold();
      if (
        !mobile ||
        !active ||
        event.button !== 0 ||
        event.pointerType === "mouse" ||
        interactive(event.target)
      )
        return;
      const x = event.clientX,
        y = event.clientY;
      hold.current = {
        x,
        y,
        timer: setTimeout(() => {
          hold.current = undefined;
          setMenu({ x, y, text, replyable });
        }, 450),
      };
    },
    onPointerMove: (event) => {
      if (
        hold.current &&
        Math.hypot(
          event.clientX - hold.current.x,
          event.clientY - hold.current.y,
        ) > 10
      )
        cancelHold();
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onPointerLeave: cancelHold,
  }), [active, mobile, cancelHold]);
  return { menu: active ? menu : undefined, bind, close, cancelHold };
}
