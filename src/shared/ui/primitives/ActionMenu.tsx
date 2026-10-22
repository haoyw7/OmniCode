import { Button } from "../forms/Button";
import { cn } from "../../lib/cn";
import { PresenceBoundary } from "../PresenceBoundary";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { LAYER } from "../../lib/layers";
import { Check, ChevronRight } from "../icons";
import { Popover } from "../Popover";
import { MenuHover } from "../MenuHover";
import type { PopoverAlign, PopoverSide } from "../../lib/popover";

type MenuAction = {
  kind: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
};

export type ActionMenuItem =
  { kind: "sep" } | (MenuAction & { submenu?: MenuAction[] });

type Props = (
  | { x: number; y: number; anchor?: never }
  | { anchor: HTMLElement; x?: never; y?: never }
) & {
  open?: boolean;
  /** Direction-key triggers can highlight an edge item when opening the menu. */
  initialHighlight?: "first" | "last";
  density?: "normal" | "compact";
  ownerId?: string;
  onBack?: () => void;
  items: ActionMenuItem[];
  ariaLabel?: string;
  header?: ReactNode;
  width?: number;
  layer?: number;
  side?: PopoverSide;
  align?: PopoverAlign;
  onPick: (id: string) => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

const MENU_WIDTH = 228;

function itemIndexAt(
  items: ActionMenuItem[],
  start: number,
  dir: 1 | -1,
): number {
  let i = start;
  while (i >= 0 && i < items.length) {
    const item = items[i];
    if (item?.kind === "item") return i;
    i += dir;
  }
  return -1;
}

export function ActionMenu({
  open,
  initialHighlight,
  density = "normal",
  x,
  y,
  anchor,
  ownerId,
  onBack,
  items,
  ariaLabel = "File actions",
  header,
  width = MENU_WIDTH,
  layer,
  side,
  align,
  onPick,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(() => initialHighlight
    ? itemIndexAt(items, initialHighlight === "first" ? 0 : items.length - 1, initialHighlight === "first" ? 1 : -1)
    : -1);
  const [submenu, setSubmenu] = useState<{
    index: number;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [submenuActive, setSubmenuActive] = useState(-1);
  const submenuItem = submenu ? items[submenu.index] : undefined;
  const submenuItems =
    submenuItem?.kind === "item" ? submenuItem.submenu : undefined;

  const cancelClose = () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const closeSubmenu = () => {
    cancelClose();
    if (submenuRef.current?.contains(document.activeElement)) {
      menuRef.current?.focus();
    }
    setSubmenu(null);
    setSubmenuActive(-1);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(closeSubmenu, 180);
  };

  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (open === false) {
      cancelClose();
      setActive(-1);
      setSubmenu(null);
      setSubmenuActive(-1);
    }
  }, [open]);

  const ids = useMemo(
    () =>
      items.flatMap((item, index) =>
        item.kind === "item"
          ? [{ index, id: item.id, disabled: !!item.disabled }]
          : [],
      ),
    [items],
  );

  const move = (dir: 1 | -1) => {
    const from = ids.findIndex((item) => item.index === active);
    const next = ids[from < 0
      ? dir === 1 ? 0 : ids.length - 1
      : (from + dir + ids.length) % ids.length];
    if (next) setActive(next.index);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" && !submenuItems && onBack) {
      e.preventDefault();
      e.stopPropagation();
      onBack();
      return;
    }
    if (submenuItems) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        closeSubmenu();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const direction = e.key === "ArrowDown" ? 1 : -1;
        setSubmenuActive((current) =>
          current < 0
            ? direction === 1
              ? 0
              : submenuItems.length - 1
            : (current + direction + submenuItems.length) % submenuItems.length,
        );
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = submenuItems[submenuActive];
        if (item && !item.disabled) onPick(item.id);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      const item = items[active];
      if (item?.kind !== "item" || item.disabled) return;
      if (item.submenu?.length) {
        const anchor = menuRef.current?.querySelector<HTMLButtonElement>(
          `[data-menu-index="${active}"]`,
        );
        if (anchor) {
          cancelClose();
          setSubmenu({ index: active, anchor });
          setSubmenuActive(0);
        }
      } else if (e.key !== "ArrowRight") {
        onPick(item.id);
      }
    }
  };

  const renderItem = (
    item: MenuAction & { submenu?: MenuAction[] },
    index: number,
    inSubmenu = false,
  ) => {
    const highlighted = index === (inSubmenu ? submenuActive : active);
    const hasSubmenu = !!item.submenu?.length;
    return (
      <Button variant="ghost" size="content"
        key={item.id}
        id={`${menuId}-${inSubmenu ? "sub-" : ""}${index}`}
        data-menu-index={index}
        data-menu-row={item.description ? "description" : "single"}
        data-highlighted={highlighted || undefined}
        data-variant={item.danger ? "destructive" : "ghost"}
        type="button"
        role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
        aria-checked={item.checked}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? submenu?.index === index : undefined}
        aria-controls={
          hasSubmenu && submenu?.index === index
            ? `${menuId}-submenu`
            : undefined
        }
        disabled={item.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={(e) => {
          cancelClose();
          if (inSubmenu) {
            setSubmenuActive(index);
            submenuRef.current?.focus();
            return;
          }
          setActive(index);
          if (hasSubmenu && !item.disabled) {
            setSubmenu({ index, anchor: e.currentTarget });
            setSubmenuActive(-1);
          } else {
            closeSubmenu();
          }
        }}
        onClick={(e) => {
          if (item.disabled) return;
          if (hasSubmenu) {
            cancelClose();
            setSubmenu({ index, anchor: e.currentTarget });
            setSubmenuActive(-1);
            submenuRef.current?.focus();
          } else {
            onPick(item.id);
          }
        }}
        className={cn("flex w-full items-center justify-start text-left", highlighted && "bg-selection")}
      >
        <MenuHover />
        {item.icon ? (
          <span aria-hidden data-menu-icon className="grid size-4 shrink-0 place-items-center">
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span data-menu-title className="block truncate leading-normal">{item.label}</span>
          {item.description ? (
            <span data-menu-description className="mt-1 block text-[11px] leading-snug text-content/50">
              {item.description}
            </span>
          ) : null}
        </span>
        {item.checked ? <Check data-menu-check className="size-4 shrink-0" /> : null}
        {item.shortcut ? <span className="shrink-0 text-[11px] text-content/40">{item.shortcut}</span> : null}
        {hasSubmenu ? <ChevronRight data-menu-arrow className="size-4 shrink-0 text-content/50" /> : null}
      </Button>
    );
  };

  return (
    <>
      <Popover
        data-menu-density={density}
        open={open}
        ref={menuRef}
        anchor={anchor ?? { x: x ?? 0, y: y ?? 0 }}
        side={side ?? (anchor ? "right" : undefined)}
        align={align}
        gap={anchor ? 4 : 0}
        layer={layer ?? (anchor ? LAYER.submenu : undefined)}
        data-menu-owner={ownerId}
        width={width}
        autoFocus
        onDismiss={(reason) => {
          if (reason === "escape" && submenu) closeSubmenu();
          else onClose();
        }}
        ignore={`[data-explorer-menu="${menuId}"]`}
        data-explorer-menu={menuId}
        role="menu"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-activedescendant={items[active]?.kind === "item" ? `${menuId}-${active}` : undefined}
        onKeyDown={onMenuKey}
        onContextMenu={(e) => e.preventDefault()}
        onMouseEnter={() => {
          cancelClose();
          onMouseEnter?.();
        }}
        onMouseLeave={() => {
          if (submenu) scheduleClose();
          onMouseLeave?.();
        }}
        className="overflow-y-auto overscroll-none p-1"
      >
        {header ? (
          <>
            {header}
            <div role="separator" className="my-1 h-px bg-content/10" />
          </>
        ) : null}
        {items.map((item, index) => {
          if (item.kind === "sep") {
            return (
              <div
                key={`sep-${index}`}
                role="separator"
                className="my-1 h-px bg-content/10"
              />
            );
          }
          return renderItem(item, index);
        })}
      </Popover>
      <PresenceBoundary propagate>{open !== false && submenu && submenuItems && submenuItem?.kind === "item" ? (
        <Popover
          data-menu-density={density}
          ref={submenuRef}
          id={`${menuId}-submenu`}
          anchor={submenu.anchor}
          side="right"
          gap={4}
          width={MENU_WIDTH}
          layer={LAYER.submenu}
          autoFocus
          role="menu"
          tabIndex={-1}
          aria-label={submenuItem.label}
          aria-activedescendant={
            submenuActive >= 0 ? `${menuId}-sub-${submenuActive}` : undefined
          }
          data-explorer-menu={menuId}
          data-menu-owner={ownerId}
          onKeyDown={onMenuKey}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={() => {
            cancelClose();
            onMouseEnter?.();
          }}
          onMouseLeave={() => {
            scheduleClose();
            onMouseLeave?.();
          }}
          className="overflow-y-auto overscroll-none p-1"
        >
          {submenuItems.map((item, index) => renderItem(item, index, true))}
        </Popover>
      ) : null}</PresenceBoundary>
    </>
  );
}
