import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef } from "react";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type Props = {
  busy: boolean;
  error?: string | null;
  onCreate: (name: string) => void;
  onCancel: () => void;
};

export function CreateBranchDialog({ busy, error, onCreate, onCancel }: Props) {
  const { t: uiT } = useTranslation();
  const form = useForm({ resolver: zodResolver(z.object({ name: z.string().trim().min(1, uiT("This field is required")) })), defaultValues: { name: "" } });
  const name = useWatch({ control: form.control, name: "name" });
  const input = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) { input.current?.focus(); toast.error(error); }
  }, [error]);

  const submit = form.handleSubmit(({ name }) => {
    if (!busy) onCreate(name);
  });

  return (
    <Modal
      title={uiT("New branch")}
      description={uiT("Create and check out a branch in this project.")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form noValidate className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">
            {uiT("Branch name")}
          </span>
          <input data-ui="input"
            data-code-label
            {...form.register("name")}
            ref={(node) => { form.register("name").ref(node); input.current = node; }}
            aria-invalid={!!form.formState.errors.name}
            type="text"
            placeholder="feature/my-branch"
            aria-label={uiT("Branch name")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={busy}
            className="h-9 rounded-md border border-content/10 bg-content/5 px-2.5 font-sans text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25 disabled:opacity-50"
          />
          <FieldError errors={[form.formState.errors.name]} />
        </label>

        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {uiT("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!trimmed || busy}>
            {busy ? (
              <Spinner className="size-3.5" />
            ) : null}
            {uiT("Create branch")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
