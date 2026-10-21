import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Popover } from "../../../shared/ui/Popover";
import { useSessionHeaderActions } from "./SessionHeaderActions";

/** The existing rename flow, shared by the overflow menu and title double-click. */
export function SessionRenamePopover({
  sessionId,
  title,
  anchor,
  onClose,
}: {
  sessionId: string;
  title: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions = useSessionHeaderActions();
  const form = useForm({ resolver: zodResolver(z.object({ title: z.string().trim() })), defaultValues: { title } });
  if (!actions) return null;

  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="start"
      width={280}
      constrainHeight={false}
      onDismiss={(reason) => {
        onClose();
        if (reason === "escape") anchor.focus();
      }}
    >
      <form
        className="p-2"
        onSubmit={form.handleSubmit(async ({ title: next }) => {
          if (form.formState.isSubmitting) return;
          try {
            if (next && next !== title) await actions.rename(sessionId, next);
            onClose();
            anchor.focus();
          } catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)); }
        })}
      >
        <input data-ui="input"
          autoFocus
          aria-label={t("Rename")}
          {...form.register("title")}
          disabled={form.formState.isSubmitting}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-md border border-content/15 bg-transparent px-2 text-[13px] text-content outline-none focus:border-input-border-hover"
        />
      </form>
    </Popover>
  );
}
