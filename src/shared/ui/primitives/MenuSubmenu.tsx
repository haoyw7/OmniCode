import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import type { PopoverAnchor } from "../Popover";
import { PresenceBoundary } from "../PresenceBoundary";
import { MenuHover } from "../MenuHover";
import { ChevronRight } from "../icons";

const SUBMENU_CLOSE_MS = 150;

export type MenuSubmenuHandlers = {
  anchor: PopoverAnchor;
  onOpenChange: (open: boolean) => void;
  onFinish: () => void;
};

/** A menu row with a side picker. Placement and exit animation belong to MenuPanel. */
export function MenuSubmenu({
  label,
  value,
  disabled = false,
  renderPicker,
  onHold,
  onFinish,
  triggerProps,
  triggerContent,
}: {
  label: string;
  value?: ReactNode;
  disabled?: boolean;
  renderPicker: (handlers: MenuSubmenuHandlers) => ReactNode;
  onHold?: (held: boolean) => void;
  onFinish: () => void;
  triggerProps?: ComponentProps<"button"> & {
    "data-ui"?: string;
    "data-highlighted"?: boolean;
  };
  triggerContent?: ReactNode;
}) {
  const [picker, setPicker] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const reportTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current == null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // StrictMode replays the picker's effects (open, closed, open) on mount, so a
  // closed report only unmounts it when no open report follows in the same tick.
  const pickerOpen = useRef(false);
  const onOpenChange = useCallback(
    (open: boolean) => {
      pickerOpen.current = open;
      onHold?.(open);
      if (reportTimer.current != null) window.clearTimeout(reportTimer.current);
      if (open) return;
      reportTimer.current = window.setTimeout(() => {
        reportTimer.current = null;
        if (!pickerOpen.current) setPicker(false);
      }, 0);
    },
    [onHold],
  );
  // Allow the pointer to cross diagonally before closing for a sibling row.
  useEffect(() => {
    if (!picker) return;
    const over = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        row.current?.contains(target) ||
        target.closest('[data-submenu="true"]')
      ) {
        cancelClose();
        return;
      }
      if (
        closeTimer.current == null &&
        row.current?.closest("[data-ui='menu-panel']")?.contains(target) &&
        target.closest("[role^='menuitem'], [role='option'], [data-menu-row]")
      ) {
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null;
          setPicker(false);
          onHold?.(false);
        }, SUBMENU_CLOSE_MS);
      }
    };
    document.addEventListener("pointerover", over);
    return () => {
      document.removeEventListener("pointerover", over);
      cancelClose();
    };
  }, [picker, onHold]);
  useEffect(() => {
    if (disabled) setPicker(false);
  }, [disabled]);
  useEffect(() => {
    if (!picker) onHold?.(false);
  }, [picker, onHold]);
  useEffect(
    () => () => {
      if (reportTimer.current != null) window.clearTimeout(reportTimer.current);
      onHold?.(false);
    },
    [onHold],
  );
  return (
    <>
      <button
        {...triggerProps}
        ref={(element) => {
          row.current = element;
          if (typeof triggerProps?.ref === "function")
            triggerProps.ref(element);
          else if (triggerProps?.ref) triggerProps.ref.current = element;
        }}
        type="button"
        role={triggerProps?.role ?? "menuitem"}
        data-ui={triggerProps?.["data-ui"] ?? "menu-submenu-trigger"}
        aria-haspopup="dialog"
        aria-expanded={picker}
        disabled={disabled}
        aria-label={
          triggerProps?.["aria-label"] ??
          (typeof value === "string" ? `${label} ${value}` : label)
        }
        data-highlighted={
          picker || triggerProps?.["data-highlighted"] || undefined
        }
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={(event) => {
          triggerProps?.onMouseEnter?.(event);
          if (!disabled) setPicker(true);
        }}
        onMouseMove={() => {
          if (!disabled && !picker) setPicker(true);
        }}
        onClick={() => setPicker(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setPicker(true);
          }
        }}
        className={
          triggerProps?.className ??
          `flex h-8 w-full items-center gap-3 px-2.5 text-left text-content/80 disabled:opacity-40 ${picker ? "bg-selection text-content" : "hover:bg-content/3"}`
        }
      >
        {triggerContent ?? (
          <>
            <MenuHover />
            <span data-menu-title className="shrink-0">
              {label}
            </span>
            <span className="ml-auto min-w-0 truncate text-content/45">
              {value}
            </span>
            <ChevronRight
              data-menu-arrow
              className="size-3.5 shrink-0 text-content/45"
            />
          </>
        )}
      </button>
      <PresenceBoundary>
        {picker && !disabled ? (
          <Fragment key="picker">
            {renderPicker({ anchor: row, onOpenChange, onFinish })}
          </Fragment>
        ) : null}
      </PresenceBoundary>
    </>
  );
}
