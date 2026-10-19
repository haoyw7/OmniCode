"use client";

import { motion } from "motion/react";
import { useCollapseMotion } from "../AnimatedCollapse";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../SurfaceVisibility";
import {
  duration,
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { MenuHover } from "../MenuHover";
import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";
import {
  ChevronDown as ChevronDownIcon,
  Check as CheckIcon,
  ChevronUp as ChevronUpIcon,
} from "../icons";

// resize 大会话时 Select trigger 跟随基础控件批量重排，
// transition-all 会把布局/滚动条相关属性也动画化；这里限定为颜色过渡。
const selectTriggerVariants = cva(
  "flex w-fit items-center justify-between gap-1.5 border whitespace-nowrap transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-placeholder:text-foreground-subtlest *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        input:
          "border-input-border bg-input text-foreground hover:border-input-border-hover focus-visible:border-input-border-hover focus-visible:bg-input-focused focus-visible:ring-0",
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-transparent text-foreground hover:bg-input/50 hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground",
        secondary:
          "border-transparent bg-secondary text-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-foreground",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 aria-expanded:bg-destructive aria-expanded:text-destructive-foreground",
      },
      size: {
        xs: "h-5 rounded-sm pl-2 pr-1 text-ui-base [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 rounded-md pl-2 pr-1 text-ui-base/relaxed [&_svg:not([class*='size-'])]:size-3",
        default:
          "h-7 rounded-md pl-2 pr-1 text-ui-base/relaxed [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 rounded-lg pl-3 pr-2 text-ui-base [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "input",
      size: "default",
    },
  },
);

const SelectMotionContext = React.createContext(false);

function Select({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const visible = useSurfaceVisibility();
  const open = visible && (controlledOpen ?? localOpen);
  return (
    <SelectMotionContext.Provider value={open}>
      <SelectPrimitive.Root
        data-slot="select"
        {...props}
        open={open}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </SelectMotionContext.Provider>
  );
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  variant = "input",
  size = "default",
  children,
  indicator,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants> & {
    indicator?: React.ReactNode;
  }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-variant={variant}
      data-size={size}
      className={cn(selectTriggerVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {indicator ?? (
          <ChevronDownIcon className="pointer-events-none size-3.5 text-foreground-subtle" />
        )}
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

// 圆角规范迁移：旧菜单沿用 xl/lg，统一为独立外壳 lg、内部选项 md；子菜单重新起算。
function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const open = React.useContext(SelectMotionContext);
  const visible = useSurfaceVisibility();
  const reduced = useMotionPreference();
  const lifetime = useCollapseMotion(open, duration.pop * 1000);
  const mounted = visible && (open || lifetime.foldState !== "closed");
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        {...props}
        forceMount={mounted ? true : undefined}
        asChild
        data-slot="select-content"
        data-fold-state={!open && mounted ? "closing" : lifetime.foldState}
        data-align-trigger={position === "item-aligned"}
        inert={!open}
        aria-hidden={!open || undefined}
        className={cn(
          "relative z-[60] max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-popover-border panel-menu p-1 text-foreground shadow-md [app-region:no-drag]",
          className,
        )}
        position={position}
        align={align}
      >
        <motion.div
          initial={reduced || !open ? false : popInitial}
          animate={open ? popAnimate : popExit}
          transition={reduced ? immediateTransition : popTransition}
          onAnimationComplete={lifetime.finish}
          style={{ ...props.style, ...(!open ? { pointerEvents: "none" } : undefined) }}
        >
          <SurfaceVisibilityContext.Provider value={visible && open}>
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
              data-menu-gutter
              data-position={position}
              className="flex flex-col gap-0.5 data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
            >
              {children}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
          </SurfaceVisibilityContext.Provider>
        </motion.div>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item> & {
  trailing?: React.ReactNode;
};

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(({ className, children, trailing, ...props }, ref) => {
  return (
    <SelectPrimitive.Item
      ref={ref}
      data-slot="select-item"
      className={cn(
        "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui-base/relaxed text-foreground outline-hidden select-none data-[highlighted]:bg-menu-hover data-[highlighted]:text-foreground data-disabled:pointer-events-none data-disabled:text-foreground-subtlest data-disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      {props.asChild ? null : <MenuHover />}
      {trailing ? (
        <span className="pointer-events-auto absolute right-2 flex items-center justify-center">
          {trailing}
        </span>
      ) : null}
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none size-4 text-foreground-subtle" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

SelectItem.displayName = "SelectItem";

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center panel-menu py-1 text-foreground-subtle [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center panel-menu py-1 text-foreground-subtle [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectItem,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
};
