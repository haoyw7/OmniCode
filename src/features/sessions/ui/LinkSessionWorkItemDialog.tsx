import { Input } from "../../../shared/ui/forms/Input";
import { cn } from "../../../shared/lib/cn";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import type { LinkedWorkItem } from "../model/session";
import { parseGithubWorkItemUrl } from "../model/sessionWorkItem";

export function LinkSessionWorkItemDialog({
  initial,
  sessionTitle,
  onSave,
  onClose,
}: {
  initial?: LinkedWorkItem;
  sessionTitle: string;
  onSave: (item: LinkedWorkItem | undefined) => void;
  onClose: () => void;
}) {
  const { t: uiT } = useTranslation();
  const form = useForm({
    resolver: zodResolver(z.object({ url: z.string().trim().refine(value => !!parseGithubWorkItemUrl(value), uiT("Enter a valid GitHub issue or pull request URL.")) })),
    defaultValues: { url: initial?.url ?? "" },
  });
  const error = form.formState.errors.url;
  const submit = form.handleSubmit(async ({ url }) => {
    try { await onSave(parseGithubWorkItemUrl(url)!); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : String(cause)); }
  });

  return (
    <Modal
      title={initial ? uiT("Edit GitHub link") : uiT("Link GitHub issue or PR")}
      description={sessionTitle}
      size="sm"
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 p-4 text-[12px]">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-content/80">
            {uiT("Issue or pull request URL")}
          </span>
          <Input data-ui="input"
            autoFocus
            type="url"
            {...form.register("url")}
            aria-label={uiT("GitHub issue or pull request URL")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "linked-work-item-error" : undefined}
            placeholder="https://github.com/owner/repo/pull/123"
            className={cn("h-9 rounded-md border bg-content/5 px-2.5 text-[13px] text-content outline-none placeholder:text-content/30", error ? "border-danger/60" : "border-content/10")}
          />
          {error ? (
<FieldError id="linked-work-item-error" errors={[error]} />
          ) : (
            <span className="text-[11px] text-content/45">
              {uiT(
                "Paste the full github.com URL. The linked item will appear on the session card.",
              )}
            </span>
          )}
        </label>
        <ModalFooter>
          {initial ? (
            <Button variant="secondary" className="mr-auto" onClick={() => onSave(undefined)}>
              {uiT("Remove link")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {uiT("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={form.formState.isSubmitting}>
            {initial ? uiT("Update link") : uiT("Link")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
