import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";
import { ChevronDown } from "../icons";
import { TypingDots } from "../TypingDots";

export function JumpToBottomButton({
  label,
  busy = false,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      data-ui="jump-to-bottom"
      data-jump-to-bottom
      className={cn("pointer-events-auto grid size-6 place-items-center rounded-md border border-content/15 bg-content/10 text-content shadow-md hover:bg-content/5 backdrop-blur-md", className)}
    >
      {busy ? (
        <TypingDots className="text-accent" />
      ) : (
        <ChevronDown className="size-4" strokeWidth={2} />
      )}
    </button>
  );
}
