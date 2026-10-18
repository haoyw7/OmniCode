import { cn } from "../../lib/cn";

/** Static placeholders avoid continuous motion and announce loading only once. */
export function AppSkeleton({ label, size = "inline", rows = 3, className }:
  { label: string; size?: "inline" | "fullscreen"; rows?: number; className?: string }) {
  return <div data-ui="app-skeleton" data-size={size} role="status" className={cn("flex min-w-0 flex-col gap-5 p-5", className)}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <div key={index} data-ui="app-skeleton-row" aria-hidden="true" className="flex gap-5 opacity-20">
      <span data-ui="app-skeleton-avatar" className="size-8 shrink-0 rounded-full bg-content/50" />
      {[0, 1, 2].map(column => <span key={column} data-ui="app-skeleton-cell" className="h-8 min-w-0 flex-1 rounded-lg bg-content/50" />)}
    </div>)}
  </div>;
}
