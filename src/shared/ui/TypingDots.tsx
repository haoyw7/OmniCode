import { cn } from "../lib/cn";
import "./typing-dots.css";

/**
 * Three 6px dots that hop 2px, 0.15s apart. Static under reduced motion.
 * Without `label` the dots are decorative (a nearby line already announces
 * the status).
 */
export function TypingDots({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("typing-dots inline-flex items-center gap-1 text-ink-tertiary", className)}
    >
      <span />
      <span />
      <span />
    </span>
  );
}
