import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Navigation destinations and disclosure state belong to the caller. */
export function NavigationItem({
  icon, children, trailing, compact = false, className, type = "button", ...props
}: ComponentPropsWithRef<"button"> & {
  icon: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button {...props} type={type} data-ui="navigation-item" data-compact={compact || undefined}
      className={cn("relative flex min-w-0 shrink-0 items-center rounded-lg text-left disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)}>
      <span data-ui="navigation-icon" aria-hidden="true">{icon}</span>
      <span data-ui="navigation-label" className={compact ? "sr-only" : "min-w-0 flex-1 truncate"}>{children}</span>
      {trailing}
    </button>
  );
}
