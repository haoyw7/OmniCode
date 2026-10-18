import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";

/** Owns the input surface, while draft, attachments and submission stay outside. */
export function MessageInput({ layout = "multiline", className, ...props }:
  ComponentPropsWithRef<"div"> & { layout?: "inline" | "multiline" }) {
  return <div {...props} data-ui="message-input" data-layout={layout} className={cn("relative", className)} />;
}
