import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";

export type RadioProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "size"
> & {
  size?: "sm" | "lg";
};

export function Radio({ size = "sm", className, ...props }: RadioProps) {
  return (
    <input
      {...props}
      type="radio"
      data-ui="radio"
      data-size={size}
      className={cn("shrink-0 accent-accent", className)}
    />
  );
}
