import type { CSSProperties } from "react";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import { useColorScheme } from "../../hooks/useColorScheme";
import { translate } from "../../i18n/language";
import { LAYER } from "../../lib/layers";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "../icons";

/**
 * shadcn/ui (radix-nova) Sonner host. Each window mounts one; callers use
 * `toast` from `sonner` directly. Colors follow the active skin variables.
 */
export function Toaster(props: ToasterProps) {
  const scheme = useColorScheme();
  return (
    <Sonner
      theme={scheme}
      position="top-center"
      offset={{ top: 52 }}
      mobileOffset={{ top: 10 }}
      visibleToasts={3}
      className="toaster group"
      containerAriaLabel={translate("Notifications")}
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <CircleAlert className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />,
        close: <X className="size-3.5" />,
      }}
      style={
        {
          zIndex: LAYER.toast,
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-stroke)",
          "--success-bg": "color-mix(in srgb, var(--color-success) 9%, var(--color-popover))",
          "--success-text": "var(--color-success)",
          "--success-border": "color-mix(in srgb, var(--color-success) 30%, var(--color-popover))",
          "--error-bg": "color-mix(in srgb, var(--color-danger) 9%, var(--color-popover))",
          "--error-text": "var(--color-danger)",
          "--error-border": "color-mix(in srgb, var(--color-danger) 30%, var(--color-popover))",
          "--warning-bg": "color-mix(in srgb, var(--color-warning) 9%, var(--color-popover))",
          "--warning-text": "var(--color-warning)",
          "--warning-border": "color-mix(in srgb, var(--color-warning) 30%, var(--color-popover))",
          "--border-radius": "12px",
        } as CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: translate("Close"),
        classNames: {
          toast: "cn-toast font-sans text-ui-base",
          description: "whitespace-pre-line text-foreground-subtle",
          actionButton: "font-medium",
        },
      }}
      richColors
      {...props}
    />
  );
}

type Outcome<T> = string | false | ((value: T) => string | false);

const durations = { success: 2600, error: 5000 } as const;

/**
 * Shows a loading toast while `task` runs, then turns it into a success or
 * error toast in place. `false` closes it silently, e.g. when the caller
 * already reports failures inline. The task's result or error passes through.
 */
export async function withToast<T>(
  task: () => Promise<T>,
  {
    loading,
    success,
    error = (reason) => (reason instanceof Error ? reason.message : String(reason)),
  }: {
    loading: string;
    success: Outcome<T>;
    error?: Outcome<unknown>;
  },
): Promise<T> {
  const id = toast.loading(loading);
  const settle = <V,>(outcome: Outcome<V>, value: V, tone: "success" | "error") => {
    const message = typeof outcome === "function" ? outcome(value) : outcome;
    if (message) toast[tone](message, { id, duration: durations[tone], closeButton: true });
    else toast.dismiss(id);
  };
  try {
    const value = await task();
    settle(success, value, "success");
    return value;
  } catch (reason) {
    settle(error, reason, "error");
    throw reason;
  }
}
