import { useEffect, useRef, useState, type ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";
import { ChevronDown } from "../icons";
import { TypingDots } from "../TypingDots";

/** Brief boundary/layout changes should not flash the jump control. */
export function useJumpToBottomVisibility(away: boolean, active = true) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!away || !active) return;
    const timer = setTimeout(() => setSettled(true), 150);
    return () => clearTimeout(timer);
  }, [away, active]);
  return away && active && settled;
}

export function JumpToBottomButton({
  label,
  busy = false,
  className,
  onClick,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  label: string;
  busy?: boolean;
}) {
  const lastClick = useRef(-Infinity);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      onClick={(event) => {
        const now = performance.now();
        if (now - lastClick.current < 300) return;
        lastClick.current = now;
        onClick?.(event);
      }}
      data-ui="jump-to-bottom"
      data-jump-to-bottom
      className={cn("active:opacity-70", cn("pointer-events-auto grid size-6 place-items-center rounded-md border border-content/15 bg-content/10 text-content shadow-md hover:bg-content/5 backdrop-blur-md", className))}
    >
      {busy ? (
        <TypingDots className="text-accent" />
      ) : (
        <ChevronDown className="size-4" />
      )}
    </button>
  );
}
