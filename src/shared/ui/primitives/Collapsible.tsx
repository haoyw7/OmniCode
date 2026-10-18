// Monocode: ZCode's Radix collapsible relies on tw-animate keyframes Monocode does
// not ship. The same API over Monocode's shared disclosure motion, so content
// animates open and closed, stays mounted until closing finishes and respects
// reduced motion.
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { AnimatedCollapse } from "../AnimatedCollapse";
import { cn } from "../../lib/cn";

type CollapsibleState = { open: boolean; setOpen: (open: boolean) => void };
const CollapsibleContext = createContext<CollapsibleState>({ open: false, setOpen: () => {} });

function Collapsible({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div data-slot="collapsible" data-state={open ? "open" : "closed"} className={className}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger({ onClick, ...props }: ComponentProps<"button">) {
  const { open, setOpen } = useContext(CollapsibleContext);
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      data-state={open ? "open" : "closed"}
      aria-expanded={open}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      {...props}
    />
  );
}

function CollapsibleContent({ className, children }: { className?: string; children?: ReactNode }) {
  const { open } = useContext(CollapsibleContext);
  return (
    <AnimatedCollapse expanded={open} motion="height">
      <div data-slot="collapsible-content" data-state={open ? "open" : "closed"} className={cn(className)}>
        {children}
      </div>
    </AnimatedCollapse>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
