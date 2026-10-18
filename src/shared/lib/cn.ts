// Merge utility classes with the application text size scale.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeUiClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-ui-xl",
        "text-ui-lg",
        "text-ui-base",
        "text-ui-caption",
        "text-ui-sm",
        "text-ui-xs",
        "text-ui-2xs",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeUiClasses(clsx(inputs));
}
