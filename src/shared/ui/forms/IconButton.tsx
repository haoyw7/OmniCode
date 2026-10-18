import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { MenuHover } from "../MenuHover";

export type IconButtonProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "aria-label"
> & {
  /** Accessible name; also the tooltip unless `tooltip` is false. */
  label: string;
  tooltip?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  shape?: "round" | "square";
  /** Pressed / open state, rendered on the raised surface. */
  active?: boolean;
  variant?: "ghost" | "secondary";
  children: ReactNode;
};

export function IconButton({
  label,
  tooltip = true,
  size = "md",
  shape = "square",
  active = false,
  variant = "ghost",
  type = "button",
  className,
  children,
  onClick,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      onClick={(event) => {
        if (props["aria-disabled"] === true || props["aria-disabled"] === "true") {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      aria-label={label}
      title={tooltip ? label : undefined}
      data-ui="icon-button"
      data-variant={variant}
      data-active={active || undefined}
      data-size={size}
      data-shape={shape}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-ink-secondary enabled:hover:bg-selection-hover enabled:hover:text-ink data-[active]:bg-raised data-[active]:text-ink",
        ({ xs: "size-5 [&_svg]:size-3", sm: "size-7 [&_svg]:size-3.5", md: "size-8 [&_svg]:size-4", lg: "size-10 [&_svg]:size-6" })[size],
        shape === "round" ? "rounded-full" : "rounded-lg",
        "transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        className,
      )}
    >
      <MenuHover />
      {children}
    </button>
  );
}
