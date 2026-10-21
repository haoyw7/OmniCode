import * as React from "react";
import { Command as CommandPrimitive, useCommandState } from "cmdk";
import { cn } from "../../lib/cn";
import { useTranslation } from "../../i18n/useTranslation";
import { Search } from "../icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./Dialog";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description,
  children,
  className,
  contentProps,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  contentProps?: React.ComponentProps<typeof DialogContent> & {
    [key: `data-${string}`]: unknown;
  };
}) {
  const { t } = useTranslation();
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        {...(!description ? { "aria-describedby": undefined } : {})}
        {...contentProps}
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl p-0",
          className,
          contentProps?.className,
        )}
      >
        <DialogTitle className="sr-only">{t(title)}</DialogTitle>
        {description && (
          <DialogDescription className="sr-only">
            {t(description)}
          </DialogDescription>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  wrapperClassName?: string;
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-stroke px-2.5 text-content/45 focus-within:text-content/70",
        wrapperClassName,
      )}
    >
      <Search className="size-4 shrink-0" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-ui-base text-content outline-none focus-visible:focus-fill placeholder:text-content/40 disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  const list = React.useRef<HTMLDivElement | null>(null);
  const value = useCommandState((state) => state.value);
  const count = useCommandState((state) => state.filtered.count);
  const selectedId = useCommandState((state) => state.selectedItemId);
  React.useLayoutEffect(() => {
    // cmdk 1.1.1 does not refresh selectedItemId for externally controlled
    // values. Synchronize its ARIA references after async options arrive.
    const selected = list.current?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]:not([aria-disabled="true"])',
    );
    const input = list.current
      ?.closest("[cmdk-root]")
      ?.querySelector("[cmdk-input]");
    for (const element of [list.current, input]) {
      if (selected) element?.setAttribute("aria-activedescendant", selected.id);
      else element?.removeAttribute("aria-activedescendant");
    }
  }, [value, count, selectedId]);
  return (
    <CommandPrimitive.List
      ref={(node) => {
        list.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="command-list"
      className={cn(
        "min-h-0 overflow-x-hidden overflow-y-auto overscroll-none outline-none focus-visible:focus-fill",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        "px-2 py-3 text-center text-ui-sm text-content/45",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-ui-sm **:[[cmdk-group-heading]]:text-content/50",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  const localRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      // cmdk 1.1.1 scrolls every ancestor on selection. Keep scrolling inside the
      // menu, including initial selection, without moving its dialog or page.
      const descriptor = Object.getOwnPropertyDescriptor(
        node,
        "scrollIntoView",
      );
      node.scrollIntoView = () => {
        const list = node.closest<HTMLElement>("[cmdk-list]");
        if (!list) return;
        const bounds = list.getBoundingClientRect();
        const row = node.getBoundingClientRect();
        if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top;
        else if (row.bottom > bounds.bottom)
          list.scrollTop += row.bottom - bounds.bottom;
      };
      const cleanup = typeof ref === "function" ? ref(node) : undefined;
      if (ref && typeof ref !== "function") ref.current = node;
      return () => {
        if (descriptor)
          Object.defineProperty(node, "scrollIntoView", descriptor);
        else delete (node as Partial<HTMLElement>).scrollIntoView;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  return (
    <CommandPrimitive.Item
      ref={localRef}
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 text-left text-ui-base text-content outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-selection hover:bg-content/3 focus-visible:bg-selection active:bg-selection",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-ui-xs text-content/50", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
