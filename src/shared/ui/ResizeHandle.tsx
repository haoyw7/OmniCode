import type { ComponentPropsWithoutRef } from "react";
import { useSurfaceVisibility } from "./SurfaceVisibility";

type Props = ComponentPropsWithoutRef<"div"> & {
  edge: "left" | "right" | "top" | "bottom";
  dragging?: boolean;
  disabled?: boolean;
};

/** A generous hit area along a thin divider; content clipping belongs inside it. */
export function ResizeHandle({
  edge,
  dragging = false,
  disabled = false,
  className = "",
  ...props
}: Props) {
  const visible = useSurfaceVisibility();
  const inactive = disabled || !visible;
  return (
    <div
      role="separator"
      aria-orientation={
        edge === "left" || edge === "right" ? "vertical" : "horizontal"
      }
      {...props}
      className={`resize-handle ${className}`}
      data-resize-edge={edge}
      data-dragging={dragging || undefined}
      data-tauri-drag-region="false"
      hidden={inactive || props.hidden}
      inert={inactive || props.inert}
      onPointerDown={inactive ? undefined : props.onPointerDown}
      onDoubleClick={inactive ? undefined : props.onDoubleClick}
    />
  );
}
