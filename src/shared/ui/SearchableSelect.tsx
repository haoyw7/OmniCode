import { motion } from "motion/react";
import { immediateTransition, popTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { useTranslation } from "../i18n/useTranslation";
import {
  useEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, ChevronRight } from "./icons";
import { cn } from "../lib/cn";
import { Button } from "./forms/Button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "./primitives/Command";
import { LAYER } from "../lib/layers";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { MenuPanel } from "./primitives/MenuPanel";
import {
  MenuSubmenu,
  type MenuSubmenuHandlers,
} from "./primitives/MenuSubmenu";
import type { PopoverAnchor } from "./Popover";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  icon?: ReactNode;
  group?: string;
  separatorBefore?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
  description?: string;
  /** Secondary text after the label, such as a file's folder. */
  detail?: string;
  renderSubmenu?: (handlers: MenuSubmenuHandlers) => ReactNode;
};

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose an option…",
  searchPlaceholder = "Search options…",
  emptyLabel = "No matching options",
  disabled = false,
  layer,
  variant = "field",
  searchable = true,
  codeLabels = false,
  align = "start",
  onOpen,
  width,
  maxHeight = 240,
  className = "",
  menuClassName = "",
  checkPosition = "start",
  commitOnTab = false,
  side = "bottom",
  gap = 4,
  triggerLabel,
  triggerIcon,
  triggerClassName = "",
  menuAnchor,
  onOpenChange,
  limit,
  overflowLabel,
}: {
  label: string;
  value: string;
  options: readonly SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  layer?: number;
  /** `icon` shows only `triggerIcon`, for toolbar pickers; `label` names it. */
  variant?: "field" | "transparent" | "row" | "panel" | "pill" | "icon";
  searchable?: boolean;
  /** Render technical values with the desktop code font, including portal options. */
  codeLabels?: boolean;
  align?: PopoverAlign;
  onOpen?: () => void;
  width?: number;
  maxHeight?: number;
  className?: string;
  menuClassName?: string;
  checkPosition?: "start" | "end";
  commitOnTab?: boolean;
  side?: PopoverSide;
  gap?: number;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  /** Render only the option panel, anchored to a parent menu row. */
  menuAnchor?: PopoverAnchor;
  onOpenChange?: (open: boolean) => void;
  /** Render at most this many matches; the rest are reached by typing. */
  limit?: number;
  /** Footer for the matches `limit` leaves out. */
  overflowLabel?: (hidden: number) => string;
}) {
  const { t: uiT } = useTranslation();
  const reduced = useMotionPreference();
  const [open, setOpen] = useState(!!menuAnchor);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menuWidth, setMenuWidth] = useState<number>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            `${option.label}\n${option.keywords ?? ""}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : [...options],
    [normalizedQuery, options],
  );
  const shown = limit != null ? filtered.slice(0, limit) : filtered;
  const hidden = filtered.length - shown.length;
  const activeValue = shown[active] ? JSON.stringify(shown[active].value) : "";
  const popoverLayer =
    layer ??
    (menuAnchor
      ? LAYER.submenu
      : root.current?.closest('[role="dialog"]')
        ? LAYER.dialogPopover
        : LAYER.popover);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  const openMenu = () => {
    if (disabled) return;
    setMenuWidth(
      width ??
        (variant === "pill" || variant === "row"
          ? Math.max(240, root.current?.getBoundingClientRect().width ?? 0)
          : root.current?.getBoundingClientRect().width),
    );
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
    onOpen?.();
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchable) search.current?.focus({ preventScroll: true });
      else list.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    setActive((index) =>
      shown.length === 0 ? 0 : Math.min(index, shown.length - 1),
    );
  }, [shown.length, open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setQuery("");
  }, [disabled]);

  useEffect(() => {
    if (open && !query)
      setActive(
        Math.max(
          0,
          options.findIndex((option) => option.value === value),
        ),
      );
  }, [open, options, value]);

  const pick = (next: string) => {
    const option = options.find((option) => option.value === next);
    if (option?.disabled) return;
    if (option?.renderSubmenu) {
      const item = Array.from(
        list.current?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [],
      ).find((item) => item.dataset.value === JSON.stringify(next));
      item?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }
    onChange(next);
    close(true);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    if (event.key === "ArrowRight" && shown[active]?.renderSubmenu && !query) {
      event.preventDefault();
      event.stopPropagation();
      pick(shown[active].value);
      return;
    }
    if (event.key === "Tab" && commitOnTab) {
      const option = shown[active];
      if (
        option &&
        !option.disabled &&
        !option.renderSubmenu &&
        option.value !== value
      )
        onChange(option.value);
      close(true);
      return;
    }
  };

  const compact = variant === "pill" || variant === "row";
  const iconOnly = variant === "icon";
  const longMenu = searchable || options.length > 12;

  const content = (
    <>
      {!menuAnchor ? (
        <Button
          variant="ghost"
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-label={
            iconOnly
              ? label
              : `${label}: ${triggerLabel ?? selected?.label ?? placeholder}`
          }
          title={iconOnly ? label : undefined}
          aria-expanded={open}
          aria-haspopup={searchable ? "dialog" : "listbox"}
          data-desktop-select-trigger={variant}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={(event) => {
            if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp"))
              return;
            event.preventDefault();
            openMenu();
          }}
          className={cn(
            triggerClassName,
            iconOnly
              ? "grid place-items-center outline-none disabled:opacity-50"
              : variant === "row"
                ? "inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-content/10 py-0 pr-1.5 pl-2 text-left text-[12px] outline-none hover:bg-content/[0.14] focus-visible:bg-content/[0.14] disabled:opacity-50"
                : variant === "panel"
                  ? "flex h-14 w-full items-center justify-end gap-3 rounded-xl border border-content/6 bg-content/6 px-4 text-right text-[14px] font-medium outline-none hover:bg-content/8 focus:border-content/12 focus:bg-content/8 disabled:opacity-50 active:scale-[0.995]"
                  : variant === "pill"
                    ? "inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-content/10 py-0 pr-1.5 pl-2 text-left text-[12px] outline-none hover:bg-content/[0.14] focus-visible:bg-content/[0.14] disabled:opacity-50"
                    : variant === "transparent"
                      ? "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-content/10 bg-transparent px-2.5 text-left text-[13px] outline-none hover:border-content/20 focus:border-content/25 disabled:opacity-50 active:scale-[0.99]"
                      : "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-content/10 bg-background-base px-2.5 text-left text-[13px] outline-none hover:border-content/20 focus:border-content/25 disabled:opacity-50 active:scale-[0.99]",
          )}
        >
          {iconOnly ? (
            triggerIcon
          ) : (
            <>
              {(triggerIcon ?? selected?.icon) ? (
                <span className="grid size-4 shrink-0 place-items-center">
                  {triggerIcon ?? selected?.icon}
                </span>
              ) : null}
              <span
                data-code-label={(codeLabels && !!selected) || undefined}
                className={cn(
                  "min-w-0 truncate leading-normal",
                  variant === "panel"
                    ? "flex-1 text-right"
                    : variant === "pill" || variant === "row"
                      ? ""
                      : "flex-1",
                  selected ? "text-content" : "text-content/40",
                )}
              >
                {triggerLabel ?? selected?.label ?? placeholder}
              </span>
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={reduced ? immediateTransition : popTransition}
                className="shrink-0"
              >
                <ChevronDown
                  className={cn(
                    "desktop-select-arrow text-content/45",
                    variant === "pill" || variant === "row"
                      ? "size-3"
                      : "size-3.5",
                  )}
                />
              </motion.span>
            </>
          )}
        </Button>
      ) : null}
      <MenuPanel
        open={open}
        anchor={menuAnchor ?? root}
        submenu={!!menuAnchor}
        side={menuAnchor ? "right" : side}
        align={align}
        gap={gap}
        width={menuAnchor ? (width ?? 260) : menuWidth}
        maxHeight={longMenu || maxHeight !== 240 ? maxHeight : undefined}
        constrainHeight={longMenu || maxHeight !== 240}
        layer={popoverLayer}
        role={searchable ? "dialog" : undefined}
        aria-label={uiT("{value0} options", { value0: String(label) })}
        data-dialog-popover
        data-menu-density={compact ? "compact" : "normal"}
        onDismiss={(reason) => close(reason === "escape")}
        className={cn("flex flex-col overflow-hidden", menuClassName)}
      >
        <Command
          shouldFilter={false}
          value={activeValue}
          label={searchable ? searchPlaceholder : label}
          onValueChange={(next) => {
            const index = shown.findIndex(
              (option) => JSON.stringify(option.value) === next,
            );
            if (index >= 0) setActive(index);
          }}
          onKeyDown={onSearchKeyDown}
        >
          {searchable ? (
            <CommandInput
              wrapperClassName="h-8"
              ref={search}
              data-code-label={codeLabels || undefined}
              aria-label={searchPlaceholder}
              value={query}
              placeholder={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onValueChange={(next) => {
                setQuery(next);
                setActive(0);
              }}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
            />
          ) : null}
          <CommandList
            ref={list}
            data-ui="select-list"
            label={label}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1 outline-none"
          >
            {shown.length > 0 ? (
              shown.map((option, index) => {
                const highlighted = index === active;
                const isSelected = option.value === value;
                const rowProps = {
                  type: "button" as const,
                  role: "option",
                  "data-desktop-select-option": true,
                  "data-ui": "select-option",
                  "data-highlighted": highlighted || undefined,
                  tabIndex: -1,
                  "aria-disabled": option.disabled || undefined,
                  title: option.description,
                  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) =>
                    event.preventDefault(),
                  className: cn(
                    "flex w-full items-center gap-2 rounded-md px-2 text-left leading-none",
                    option.disabled && "opacity-45",
                    compact ? "h-7 text-[12px]" : "h-8 text-[13px]",
                    highlighted
                      ? "bg-selection text-content"
                      : "text-content/75 hover:bg-content/3 hover:text-content",
                  ),
                };
                const rowContent = (
                  <>
                    {checkPosition === "start" ? (
                      <span
                        data-ui="select-check-slot"
                        className="grid size-3.5 shrink-0 place-items-center"
                      >
                        {isSelected ? (
                          <Check
                            data-ui="select-check"
                            className="size-3"
                            strokeWidth={2}
                          />
                        ) : null}
                      </span>
                    ) : null}
                    {option.icon ? (
                      <span className="grid size-4 shrink-0 place-items-center">
                        {option.icon}
                      </span>
                    ) : null}
                    <span
                      data-code-label={codeLabels || undefined}
                      className="min-w-0 flex-1 truncate leading-normal"
                    >
                      {option.label}
                      {option.detail ? (
                        <span
                          data-ui="select-option-detail"
                          className="ml-1.5 text-content/45"
                        >
                          {option.detail}
                        </span>
                      ) : null}
                    </span>
                    {checkPosition === "end" && isSelected ? (
                      <Check
                        data-ui="select-check"
                        className="size-4 shrink-0"
                      />
                    ) : null}
                    {option.renderSubmenu ? (
                      <ChevronRight className="size-4 shrink-0 text-content/50" />
                    ) : (
                      option.trailing
                    )}
                  </>
                );

                return (
                  <Fragment key={option.value}>
                    {option.separatorBefore && index > 0 ? (
                      <div
                        role="presentation"
                        data-ui="select-separator"
                        className="my-1 border-t border-stroke"
                      />
                    ) : null}
                    {option.group &&
                    option.group !== shown[index - 1]?.group ? (
                      <div
                        role="presentation"
                        data-ui="select-group-label"
                        className="px-2 py-1 text-ui-sm font-medium text-content/50"
                      >
                        {option.group}
                      </div>
                    ) : null}
                    {option.renderSubmenu ? (
                      <MenuSubmenu
                        label={option.label}
                        disabled={option.disabled}
                        renderPicker={option.renderSubmenu}
                        onFinish={() => close(true)}
                        triggerProps={rowProps}
                        triggerContent={rowContent}
                        renderTrigger={(trigger) => (
                          <CommandItem
                            asChild
                            value={JSON.stringify(option.value)}
                            disabled={option.disabled}
                            onSelect={() => pick(option.value)}
                          >
                            {trigger}
                          </CommandItem>
                        )}
                      />
                    ) : (
                      <CommandItem
                        asChild
                        value={JSON.stringify(option.value)}
                        disabled={option.disabled}
                        onSelect={() => pick(option.value)}
                      >
                        <Button variant="ghost" {...rowProps}>
                          {rowContent}
                        </Button>
                      </CommandItem>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <p className="px-2 py-3 text-center text-[12px] text-content/45">
                {emptyLabel}
              </p>
            )}
          </CommandList>
          {hidden > 0 && overflowLabel ? (
            <p
              data-ui="select-overflow"
              className="shrink-0 border-t border-stroke px-2.5 py-2 text-[12px] text-content/45"
            >
              {overflowLabel(hidden)}
            </p>
          ) : null}
        </Command>
      </MenuPanel>
    </>
  );

  // An anchored submenu only renders its portal; no placeholder belongs in
  // the parent list's layout, including during its closing animation.
  return menuAnchor ? (
    content
  ) : (
    <div
      ref={root}
      className={cn(
        variant === "pill" || variant === "row"
          ? "relative inline-flex max-w-56 shrink-0"
          : iconOnly
            ? "relative inline-flex shrink-0"
            : "relative min-w-0",
        className,
      )}
    >
      {content}
    </div>
  );
}
