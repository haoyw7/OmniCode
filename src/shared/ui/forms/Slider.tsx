import type { ComponentProps } from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export function Slider({
  className, defaultValue, value, min = 0, max = 100,
  "aria-label": label, "aria-labelledby": labelledBy, "aria-valuetext": valueText, ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const values = value ?? defaultValue ?? [min, max];
  return (
    <SliderPrimitive.Root
      data-ui="slider" data-slot="slider"
      defaultValue={defaultValue} value={value} min={min} max={max}
      className={cn("relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col", className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1">
        <SliderPrimitive.Range data-slot="slider-range"
          className="absolute bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb key={index} data-slot="slider-thumb" aria-label={label} aria-labelledby={labelledBy} aria-valuetext={valueText}
          className="relative block size-3 shrink-0 rounded-full border border-ring bg-background ring-ring/50 transition-shadow select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:focus-fill active:ring-3 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none" />
      ))}
    </SliderPrimitive.Root>
  );
}
