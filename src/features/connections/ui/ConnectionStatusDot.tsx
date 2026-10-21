import { cn } from "../../../shared/lib/cn";
import type { ReactNode } from "react";

export type ConnectionState = "online" | "offline" | "error" | "checking";

const DOT: Record<ConnectionState, string> = {
  online: "bg-success",
  offline: "bg-content/30",
  error: "bg-danger",
  checking: "bg-content/20 animate-pulse motion-reduce:animate-none",
};

/** A row icon with a presence dot at its lower-right corner. */
export function ConnectionStatusIcon({
  state,
  label,
  children,
}: {
  state: ConnectionState;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="relative shrink-0 text-foreground-subtle" title={label}>
      {children}
      <span
        role="img"
        aria-label={label}
        className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card transition-colors", DOT[state])}
      />
    </span>
  );
}
