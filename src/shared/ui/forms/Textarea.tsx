import * as React from "react";

import { cn } from "../../lib/cn";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { size?: "sm" | "md"; variant?: "default" | "editor" }
>(function Textarea({ className, size = "md", variant = "default", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-ui="textarea"
      data-slot="textarea"
      data-size={size}
      data-variant={variant}
      className={cn(
        "w-full resize-none transition-colors outline-none placeholder:text-muted-foreground focus-visible:focus-fill disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        variant === "editor"
          ? "field-sizing-fixed min-h-0 rounded-none border-0 bg-transparent p-0"
          : "flex field-sizing-content min-h-16 rounded-md border border-input bg-input/20 px-2 py-2 text-ui-base md:text-ui-base/relaxed",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
