import { AnimatePresence, motion } from "motion/react";
import {
  popInitial,
  popAnimate,
  popExit,
  popTransition,
  immediateTransition,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { MotionPresenceItem } from "./MotionPresenceItem";
("use client");

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

const TooltipMotionContext = React.createContext(false);
function Tooltip({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <TooltipMotionContext.Provider value={open}>
      <TooltipPrimitive.Root
        {...props}
        open={open}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </TooltipMotionContext.Provider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const open = React.useContext(TooltipMotionContext);
  const reduced = useMotionPreference();
  const content = open && (
    <MotionPresenceItem key="tooltip">
      <TooltipPrimitive.Content
        forceMount
        asChild
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-lg border border-border bg-tooltip px-3 py-1.5 text-ui-sm text-tooltip-foreground has-data-[slot=kbd]:pr-1.5     **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
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
          {children}
        </motion.div>
      </TooltipPrimitive.Content>
    </MotionPresenceItem>
  );
  return (
    <TooltipPrimitive.Portal forceMount>
      {<AnimatePresence>{content}</AnimatePresence>}
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
