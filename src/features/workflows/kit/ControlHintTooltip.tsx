// Monocode shim for ZCode's ControlHintTooltip: a Radix tooltip with title and description.
import type { ReactNode, Ref } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/primitives/Tooltip.js";
import { cn } from "../../../shared/lib/cn";

export interface ControlHintTooltipProps {
  children: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  shortcut?: string;
  standalone?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
  triggerClassName?: string;
  triggerRef?: Ref<HTMLElement>;
}

export function ControlHintTooltip({ children, title, description, shortcut, open, onOpenChange, side = "top", align = "center", sideOffset = 2, className }: ControlHintTooltipProps) {
  return (
    <Tooltip {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} className={cn("max-w-72", className)}>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span>{title}</span>
            {shortcut ? <span className="font-mono opacity-70">{shortcut}</span> : null}
          </span>
          {description ? <span className="opacity-70">{description}</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
