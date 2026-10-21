import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FieldError } from "../../../../../shared/ui/primitives/Field";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { useRef, useState } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { Button } from "../../../../../shared/ui/forms/Button";
import { ExternalLink, Pencil, RefreshCw } from "../../../../../shared/ui/icons";
import {
  inspectHarnessBinary,
} from "../../../../../integrations/harness/core/child";
import { revealPath } from "../../../../../platform/tauri/fs";
import {
  loadProviderBinaryPath,
  providerBinaryPathChangePending,
  saveProviderBinaryPath,
  type ConfigurableBinaryProvider,
} from "../../../../providers/model/providerBinaryPaths";
import { HARNESS_TITLE } from "../../../../sessions/model/session";
import { Row } from "../../settingsLayout";
import { binaryInspectionError } from "./providerBinaryValidation";

/** The CLI a provider runs: where it resolves, its version and a path override. */
export function ProviderBinaryPath({
  provider,
  available,
}: {
  provider: ConfigurableBinaryProvider;
  /** A missing CLI is expected before install, so it is not an error. */
  available: boolean;
}) {
  const { t: uiT } = useTranslation();
  const editButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const form = useForm({
    resolver: zodResolver(z.object({ path: z.string().trim() })),
    defaultValues: { path: loadProviderBinaryPath(provider) ?? "" },
  });
  const draft = useWatch({ control: form.control, name: "path" });
  const setDraft = (path: string) => form.reset({ path });
  const [overridden, setOverridden] = useState(() =>
    Boolean(loadProviderBinaryPath(provider)),
  );
  const [requestedPath, setRequestedPath] = useState(() => loadProviderBinaryPath(provider));
  const [discarded, setDiscarded] = useState(false);
  const options = (binaryPath?: string | null) => ({
    queryKey: ["providerBinary", provider, binaryPath ?? null],
    queryFn: () => inspectHarnessBinary(provider, binaryPath),
  });
  const read = useQuery(options(requestedPath), queryClient);
  const inspection = discarded ? undefined : read.data, working = read.isFetching;
  const error = read.error ? String(read.error instanceof Error ? read.error.message : read.error) : inspection ? binaryInspectionError(provider, inspection) : null;
  const setFormError = (message: string | null) => {
    if (!message) { form.clearErrors("path"); return; }
    form.setError("path", { type: "server", message: uiT(message) });
    toast.error(uiT(message));
  };
  const [revealError, setRevealError] = useState<string | null>(null);
  const inspect = async (binaryPath?: string | null): Promise<string | null> => {
    setRequestedPath(binaryPath ?? null); setDiscarded(false); setRevealError(null);
    try { return binaryInspectionError(provider, await queryClient.fetchQuery(options(binaryPath))); }
    catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
  };

  const closeEditor = () => {
    setFormError(null);
    setEditing(false);
    queueMicrotask(() => editButton.current?.focus());
  };

  const useAuto = async () => {
    if (working) return;
    setFormError(null);
    const problem = await inspect(null);
    if (problem) {
      setFormError(problem);
      return;
    }
    if (!saveProviderBinaryPath(provider, null)) {
      setDiscarded(true);
      setFormError("Could not save the binary path.");
      return;
    }
    setDraft("");
    setOverridden(false);
    closeEditor();
  };

  const submit = form.handleSubmit(async ({ path: value }) => {
    if (working) return;
    if (!value) {
      await useAuto();
      return;
    }
    setFormError(null);
    const problem = await inspect(value);
    if (problem) {
      setFormError(problem);
      return;
    }
    if (!saveProviderBinaryPath(provider, value)) {
      setDiscarded(true);
      setFormError("Could not save the binary path.");
      return;
    }
    setOverridden(true);
    closeEditor();
  });

  const title = HARNESS_TITLE[provider];
  const restartRequired = providerBinaryPathChangePending(provider);
  // Before install the CLI is simply absent; only a configured path or an
  // installed CLI that fails to resolve needs attention.
  const failed = Boolean(error) && (available || overridden);
  const missing = Boolean(error) && !failed;
  const status = failed
    ? uiT("Needs attention")
    : restartRequired
      ? uiT("Restart required")
      : overridden
        ? uiT("Configured")
        : missing
          ? uiT("Not installed")
          : uiT("Auto-detected");

  return (
    <>
      <Row
        label={
          <span className="flex flex-wrap items-center gap-1.5">
            {uiT("CLI path")}
            <span data-ui="provider-chip">{uiT("Global")}</span>
            <span
              data-ui="provider-chip"
              data-tone={failed ? "danger" : restartRequired ? "warning" : undefined}
            >
              {status}
            </span>
          </span>
        }
        description={
          <span aria-busy={working} className="block min-w-0">
            <span className="block break-all font-mono text-[11px] text-content/65">
              {inspection?.path ??
                (working
                  ? uiT("Checking the selected CLI…")
                  : missing
                    ? uiT("Not found on this computer")
                    : uiT("CLI could not be resolved"))}
            </span>
            {inspection?.version ? (
              <span className="mt-0.5 block break-words text-[11px] text-content/40">
                {inspection.version}
              </span>
            ) : null}
            {failed ? (
              <span
                role="alert"
                title={error ?? undefined}
                className="mt-1 block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-red-400"
              >
                {error}
              </span>
            ) : null}
            {revealError ? (
              <span
                role="alert"
                className="mt-1 block whitespace-pre-wrap break-words text-[11px] leading-4 text-red-400"
              >
                {uiT("Could not open the CLI location: ")}
                {revealError}
              </span>
            ) : null}
          </span>
        }
      >
        {error ? (
          <Button
            variant="secondary"
            disabled={working || form.formState.isSubmitting}
            aria-label={uiT("Retry {value0} {value1}", {
              value0: String(title),
              value1: String(overridden ? "configured path" : "auto-detect"),
            })}
            onClick={() =>
              void inspect(overridden ? draft.trim() || null : null)
            }
          >
            <RefreshCw className="size-3.5" />
            {overridden ? uiT("Retry configured path") : uiT("Retry auto-detect")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          aria-label={uiT("Open {value0} CLI location", { value0: String(title) })}
          disabled={!inspection}
          onClick={() => {
            if (!inspection) return;
            setRevealError(null);
            void revealPath(inspection.path).catch((cause) => {
              setRevealError(
                cause instanceof Error ? cause.message : String(cause),
              );
            });
          }}
        >
          <ExternalLink className="size-3.5" />
          {uiT("Open location")}
        </Button>
        <Button
          ref={editButton}
          variant="secondary"
          aria-label={uiT("Edit {value0} CLI path", { value0: String(title) })}
          aria-expanded={editing}
          aria-controls={`${provider}-binary-editor`}
          disabled={working && !editing}
          onClick={() => {
            if (editing) {
              setDraft(loadProviderBinaryPath(provider) ?? "");
              setFormError(null);
              setEditing(false);
            } else {
              setEditing(true);
            }
          }}
        >
          <Pencil className="size-3.5" />
          {uiT("Edit path")}
        </Button>
      </Row>
      <AnimatedCollapse expanded={editing}>
        <form
          id={`${provider}-binary-editor`}
          className="px-4 pb-3"
          noValidate
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setDraft(loadProviderBinaryPath(provider) ?? "");
            closeEditor();
          }}
        >
          <label
            htmlFor={`${provider}-binary-path`}
            className="text-[11px] text-content/50"
          >
            {uiT("CLI path")}
          </label>
          <input
            data-ui="input"
            id={`${provider}-binary-path`}
            type="text"
            {...form.register("path")}
            aria-invalid={!!form.formState.errors.path}
            placeholder={inspection?.path ?? uiT("Auto-detected path")}
            disabled={working || form.formState.isSubmitting}
            autoFocus
            className="mt-1.5 h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2 font-mono text-[11px] text-content outline-none placeholder:font-sans placeholder:text-content/35 focus:border-input-border-hover disabled:opacity-50"
          />
          <p className="mt-1.5 text-[11px] text-content/40">
            {uiT(
              "Enter the absolute path to the CLI executable. Changes apply after restarting OmniCode.",
            )}
          </p>
          <FieldError errors={[form.formState.errors.path]} />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              disabled={working || form.formState.isSubmitting}
              onClick={() => {
                setDraft(loadProviderBinaryPath(provider) ?? "");
                closeEditor();
              }}
            >
              {uiT("Cancel")}
            </Button>
            {overridden ? (
              <Button
                variant="secondary"
                disabled={working || form.formState.isSubmitting}
                onClick={() => void useAuto()}
              >
                {uiT("Use auto-detected path")}
              </Button>
            ) : null}
            <Button variant="primary" type="submit" disabled={working || form.formState.isSubmitting}>
              {uiT("Save path")}
            </Button>
          </div>
        </form>
      </AnimatedCollapse>
    </>
  );
}
