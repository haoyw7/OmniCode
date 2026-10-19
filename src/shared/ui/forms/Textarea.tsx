import * as React from "react";

import { cn } from "../../lib/cn";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { size?: "sm" | "md" }
>(function Textarea({ className, size = "md", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-ui="textarea"
      data-slot="textarea"
      data-size={size}
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 text-ui-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-input-border-hover focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-ui-base/relaxed",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
