import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Presentation only: the feature supplies its mascot, clock, and status copy. */
export function AssistantStatus({ icon, children, className, ...props }:
  ComponentPropsWithRef<"div"> & { icon: ReactNode }) {
  return (
    <div {...props} data-ui="assistant-status" className={cn("flex min-w-0 items-center gap-2 px-4 pt-2 pb-1 font-sans text-sm @md:px-6", className)}>
      <span data-ui="assistant-status-icon" className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-full">{icon}</span>
      {children}
    </div>
  );
}
