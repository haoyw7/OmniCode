import { motion } from "motion/react";
import {
  immediateTransition,
  panelTransition,
  motionGeometry,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

const MotionThumb = motion.create(SwitchPrimitive.Thumb);

function Switch({
  className,
  size = "default",
  checked: controlledChecked,
  defaultChecked = false,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  const [localChecked, setLocalChecked] = React.useState(defaultChecked);
  const checked = controlledChecked ?? localChecked;
  const reduced = useMotionPreference();
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => {
        if (controlledChecked === undefined) setLocalChecked(next);
        onCheckedChange?.(next);
      }}
      data-ui="switch"
      data-slot="switch"
      data-size={size}
      className={cn(
        "p-px peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-input-border-focused/30 aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=default]:h-[18px] data-[size=default]:w-[32px] data-[size=sm]:h-[16px] data-[size=sm]:w-[28px] dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-primary/30 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <MotionThumb
        initial={false}
        animate={{
          x: checked
            ? `var(--switch-travel, ${size === "sm" ? motionGeometry.switchSmallTravel : motionGeometry.switchTravel}px)`
            : 0,
        }}
        transition={reduced ? immediateTransition : panelTransition}
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-primary-foreground ring-0 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
