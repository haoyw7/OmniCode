import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../lib/cn";

type AppSurfaceProps =
  | (ComponentPropsWithRef<"div"> & { as?: "div" })
  | (ComponentPropsWithRef<"aside"> & { as: "aside" });

export function AppSurface(props: AppSurfaceProps) {
  const classes = "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-content/15 bg-panel";
  if (props.as === "aside") {
    const { as: _as, className, ...native } = props;
    return <aside {...native} data-ui="app-surface" className={cn(classes, className)} />;
  }
  const { as: _as, className, ...native } = props;
  return <div {...native} data-ui="app-surface" className={cn(classes, className)} />;
}

export function AppName({ icon, children, className, ...props }:
  ComponentPropsWithRef<"div"> & { icon: ReactNode }) {
  return <div {...props} data-ui="app-name" className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
    <span data-ui="app-icon" className="grid size-5 shrink-0 place-items-center overflow-hidden rounded border border-content/15 [&>svg]:size-4" aria-hidden="true">{icon}</span>
    <span className="min-w-0 truncate">{children}</span>
  </div>;
}

/** Slots keep app identity, metadata and actions independent of their meaning. */
export function AppHeader({ children, metadata, actions, size = "inline", className, ...props }:
  ComponentPropsWithRef<"div"> & { metadata?: ReactNode; actions?: ReactNode; size?: "inline" | "fullscreen" }) {
  return <div {...props} data-ui="app-header" data-size={size} className={cn("relative flex shrink-0 items-center gap-2 border-b border-content/10 px-3", className)}>
    {children}
    {metadata ? <span data-ui="app-metadata" className="min-w-0 truncate text-xs text-content/50">{metadata}</span> : null}
    {actions ? <div data-ui="app-actions" className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
  </div>;
}
