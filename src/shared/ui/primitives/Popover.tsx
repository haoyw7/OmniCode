"use client";

import { MotionPresenceItem } from "./MotionPresenceItem";
import { AnimatePresence, motion } from "motion/react";
import { immediateTransition, popAnimate, popExit, popInitial, popTransition } from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

const PopoverMotionContext = React.createContext(false);

function Popover({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <PopoverMotionContext.Provider value={open}>
      <PopoverPrimitive.Root
        data-slot="popover"
        {...props}
        open={open}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </PopoverMotionContext.Provider>
  );
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const open = React.useContext(PopoverMotionContext);
  const reduced = useMotionPreference();
  const presence = (
    <AnimatePresence>
      {open && (
        <MotionPresenceItem key="content">
          <PopoverPrimitive.Content
            forceMount
            asChild
            data-slot="popover-content"
            align={align}
            sideOffset={sideOffset}
            className={cn(
              // Popover 与 tooltip 同为 z-50 时，后挂载的辅助提示会覆盖正在操作的浮层。
              "z-[60] flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-xl bg-popover p-2.5 text-ui-base text-popover-foreground shadow-md border border-border overflow-hidden outline-hidden           ",
              className,
            )}
            {...props}
          >
            <motion.div
              initial={reduced ? false : popInitial}
              animate={popAnimate}
              exit={popExit}
              transition={reduced ? immediateTransition : popTransition}
            >
              {props.children}
            </motion.div>
          </PopoverPrimitive.Content>
        </MotionPresenceItem>
      )}
    </AnimatePresence>
  );
  return (
    <PopoverPrimitive.Portal forceMount>{presence}</PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("text-ui-base font-medium", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
};
