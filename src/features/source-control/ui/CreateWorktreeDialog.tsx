import { Input } from "../../../shared/ui/forms/Input";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { useEffect, useMemo, useRef } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { LAYER } from "../../../shared/lib/layers";
import { createWorktree, type Worktree } from "../model/worktrees";
import { prettyCwd } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/forms/Button";
import { Modal, ModalFooter } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

export function CreateWorktreeDialog({
  cwd,
  baseCwd,
  defaultRoot,
  onCreated,
  onCancel,
}: {
  cwd: string;
  baseCwd: string;
  defaultRoot?: string;
  onCreated: (tree: Worktree) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t: uiT } = useTranslation();
  const { branches } = useProjectBranchesState(baseCwd, true);
  const form = useForm({
    resolver: zodResolver(z.object({
      name: z.string().trim().min(1, uiT("This field is required")),
      base: z.string().min(1, uiT("This field is required")),
      existing: z.boolean(),
    })),
    defaultValues: { name: "", base: "HEAD", existing: false },
  });
  const [name, base, existing] = useWatch({ control: form.control, name: ["name", "base", "existing"] });
  const mutation = useMutation({ mutationFn: async (action: () => Promise<void>) => action() }, queryClient);
  const busy = mutation.isPending;
  const error = mutation.error ? String(mutation.error) : undefined;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (existing) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [existing]);
  const localBranches = useMemo(
    () =>
      (branches?.branches ?? [])
        .filter((branch) => !branch.remote)
        .map((branch) => ({ value: branch.name, label: branch.name })),
    [branches],
  );
  const baseOptions = useMemo(
    () => [
      {
        value: "HEAD",
        label: uiT("Current commit{value0}", {
          value0: String(branches?.current ? ` (${branches.current})` : ""),
        }),
        keywords: "HEAD current commit",
      },
      ...(branches?.branches ?? []).map((branch) => {
        const ref = branch.remote
          ? `${branch.remote}/${branch.name}`
          : branch.name;
        return { value: ref, label: ref };
      }),
    ],
    [branches, uiT],
  );
  const submit = form.handleSubmit(({ name, base, existing }) => {
    if (busy) return;
    mutation.mutate(async () => {
      await withToast(
        async () => onCreated(await createWorktree(baseCwd, name.trim(), base, existing)),
        {
          loading: uiT("Creating worktree…"),
          success: uiT("Worktree created"),
        },
      );
    });
  });
  const field =
    "h-9 rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] outline-none focus-visible:focus-fill disabled:opacity-50";
  return (
    <Modal
      title={uiT("Create worktree")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4 p-4"
        noValidate
        onSubmit={submit}
      >
        <p className="text-[12px] text-content/55">
          {uiT("An independent working copy of ")}
          {prettyCwd(cwd)}. Existing uncommitted changes stay in their current
          working copy.
        </p>
        <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
          <span>{uiT("Branch")}</span>
          <SearchableSelect
            variant="transparent"
            label={uiT("Branch type")}
            disabled={busy}
            value={existing ? "existing" : "new"}
            options={[
              { value: "new", label: uiT("Create a new branch") },
              { value: "existing", label: uiT("Use an existing local branch") },
            ]}
            onChange={(value) => {
              form.setValue("existing", value === "existing");
              form.resetField("name");
            }}
            searchPlaceholder="Search options…"
            layer={LAYER.dialogPopover}
          />
        </div>
        <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
          <span>
            {existing ? uiT("Existing branch") : uiT("New branch name")}
          </span>
          {existing ? (
            <SearchableSelect
              variant="transparent"
              codeLabels
              label={uiT("Existing branch")}
              value={name}
              disabled={busy}
              options={localBranches}
              onChange={(value) => form.setValue("name", value, { shouldValidate: true })}
              placeholder={uiT("Choose a branch…")}
              searchPlaceholder="Search local branches…"
              emptyLabel="No matching local branches"
              layer={LAYER.dialogPopover}
            />
          ) : (
            <Input data-ui="input"
              data-code-label
              {...form.register("name")}
              ref={(node) => { form.register("name").ref(node); input.current = node; }}
              aria-invalid={!!form.formState.errors.name}
              aria-label={uiT("New branch name")}
              className={field}
              value={name}
              disabled={busy}
              placeholder="feature/my-task"
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <FieldError errors={[form.formState.errors.name]} />
        </div>
        {!existing && (
          <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
            <span>{uiT("Start from")}</span>
            <SearchableSelect
              variant="transparent"
              codeLabels
              label={uiT("Start from")}
              value={base}
              disabled={busy}
              options={baseOptions}
              onChange={(value) => form.setValue("base", value)}
              searchPlaceholder="Search branches and refs…"
              layer={LAYER.dialogPopover}
            />
          </div>
        )}
        {defaultRoot && (
          <p className="break-all text-[11px] text-content/40">
            {uiT("Created in ")}
            {prettyCwd(defaultRoot)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        <ModalFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {uiT("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy && <Spinner className="size-3.5" />}
            {uiT("Create worktree")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
