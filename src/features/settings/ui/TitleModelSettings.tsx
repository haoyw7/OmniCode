import { Checkbox } from "../../../shared/ui/forms/Checkbox";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Input } from "../../../shared/ui/forms/Input";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { useEffect, useId, useState } from "react";
import {
  remoteRequest,
  useRemoteMachines,
} from "../../connections/model/connections";
import { sharedHostMachineId } from "../../connections/model/remoteProjects";
import {
  DEFAULT_TITLE_MODEL,
  type TitleModelStatus,
  type TitleModelUpdate,
} from "../../sessions/model/titleModel";
import type { GeneratedSessionTitle } from "../../sessions/model/sessionTitle";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { Button } from "../../../shared/ui/forms/Button";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";

const fieldClass =
  "h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2.5 text-[12px] text-content outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-content/35 focus:border-input-border-hover disabled:opacity-50";

export function TitleModelSettings({
  revealed = false,
}: {
  revealed?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(revealed);
  const contentId = useId();
  useEffect(() => {
    if (revealed) setExpanded(true);
  }, [revealed]);
  return (
    <>
      <Button variant="ghost" size="content"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-[13px] font-medium text-content transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {t("Model API configuration")}
        <DisclosureChevron expanded={expanded} direction="down"
          aria-hidden="true"
          className="size-4 shrink-0"
        />
      </Button>
      <div id={contentId}>
        <AnimatedCollapse expanded={expanded} keepMounted>
          <TitleModelConfiguration />
        </AnimatedCollapse>
      </div>
    </>
  );
}

function TitleModelConfiguration() {
  const { t } = useTranslation();
  const { machines } = useRemoteMachines();
  const [selected, setSelected] = useState(sharedHostMachineId() ?? "");
  const machineId = selected || sharedHostMachineId() || "";
  return (
    <div className="space-y-3 border-t border-content/5 px-4 py-3.5">
      <p className="text-[12px] leading-relaxed text-content/45">
        {t(
          "Generate titles with a separate model API. Provider titles and manual names keep their priority. Without this configuration, OmniCode keeps the existing title.",
        )}
      </p>
      <div className="space-y-1 text-[12px] text-content/65">
        <span>{t("Machine")}</span>
        <SearchableSelect
          label={t("Machine")}
          value={machineId}
          onChange={setSelected}
          placeholder={t("Select a machine")}
          variant="transparent"
          searchable={false}
          options={[
            ...(machineId &&
            !machines.some((machine) => machine.id === machineId)
              ? [{ value: machineId, label: t("This machine") }]
              : []),
            ...machines.map((machine) => ({
              value: machine.id,
              label: machine.name,
            })),
          ]}
        />
      </div>
      {machineId && <TitleModelForm key={machineId} machineId={machineId} />}
    </div>
  );
}

function TitleModelForm({ machineId }: { machineId: string }) {
  const { t } = useTranslation();
  const errorText = (message: string) => {
    const http = /^Title model returned HTTP (\d+)\.$/.exec(message);
    return http
      ? t("Title model returned HTTP {status}.", { status: http[1] })
      : t(message);
  };
  const schema = z.object({
    enabled: z.boolean(),
    endpoint: z.string().trim(),
    model: z.string().trim(),
    key: z.string().trim(),
    clearKey: z.boolean(),
  }).superRefine((values, ctx) => {
    if (!values.enabled) return;
    if (!z.url({ protocol: /^https?$/ }).safeParse(values.endpoint).success) {
      ctx.addIssue({ code: "custom", path: ["endpoint"], message: t("Enter a valid HTTP or HTTPS URL") });
    }
    if (!values.model) ctx.addIssue({ code: "custom", path: ["model"], message: t("This field is required") });
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { enabled: DEFAULT_TITLE_MODEL.enabled, endpoint: DEFAULT_TITLE_MODEL.endpoint, model: DEFAULT_TITLE_MODEL.model, key: "", clearKey: false },
  });
  const settings = useWatch({ control: form.control });
  const { key, clearKey } = settings;
  const { reset } = form;
  const dirty = form.formState.isDirty;
  const visible = useSurfaceVisibility();
  const queryKey = ["titleModel", machineId] as const;
  const read = useQuery({ queryKey, queryFn: () => remoteRequest<TitleModelStatus>(machineId, "titleModel.status"), enabled: visible }, queryClient);
  const [notice, setNotice] = useState("");
  const mutation = useMutation({ mutationFn: async (action: () => Promise<void>) => action() }, queryClient);
  const probe = useMutation({ mutationFn: () => remoteRequest<GeneratedSessionTitle | null>(machineId, "titleModel.test") }, queryClient);
  const loading = read.isPending, loaded = !!read.data, busy = mutation.isPending || probe.isPending, testing = probe.isPending;
  const problem = mutation.error ?? probe.error ?? read.error;
  const error = problem ? String(problem instanceof Error ? problem.message : problem) : "";
  useEffect(() => {
    if (read.data && !dirty && !busy) reset({ enabled: read.data.enabled, endpoint: read.data.endpoint, model: read.data.model, key: "", clearKey: false });
  }, [read.data, dirty, busy, reset]);

  function change(name: keyof z.infer<typeof schema>, value: string | boolean) {
    form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    setNotice("");
  }
  const save = form.handleSubmit((values) => {
    if (busy || loading || !loaded || !dirty) return;
    setNotice("");
    probe.reset();
    mutation.mutate(async () => {
      const update: TitleModelUpdate = {
        enabled: values.enabled,
        endpoint: values.endpoint,
        model: values.model,
        ...(values.clearKey
          ? { apiKey: "" }
          : values.key
            ? { apiKey: values.key }
            : {}),
      };
      const saved = await withToast(
          () => remoteRequest<TitleModelStatus>(machineId, "titleModel.save", update),
          { loading: t("Saving…"), success: t("Saved"), error: (reason) => errorText(reason instanceof Error ? reason.message : String(reason)) },
        );
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, saved);
      reset({ enabled: saved.enabled, endpoint: saved.endpoint, model: saved.model, key: "", clearKey: false });
    });
  });
  async function test() {
    mutation.reset(); setNotice("");
    try {
      const result = await probe.mutateAsync();
      setNotice(result ? t("Connection successful: {title}", { title: result.title }) : t("Title generation is disabled."));
    } catch { /* Expose the mutation error next to the controls. */ }
  }
  return (
    <form noValidate onSubmit={save}>
    <fieldset disabled={loading || busy || !loaded} className="space-y-3">
      <label className="flex items-center gap-2 text-[13px] text-content">
        <Checkbox
          checked={settings.enabled}
          onCheckedChange={(checked) => change("enabled", checked === true)}
        />
        {t("Generate titles with model API")}
      </label>
      <label className="block space-y-1 text-[12px] text-content/65">
        <span>{t("Chat Completions endpoint")}</span>
        <Input
          className={fieldClass}
          type="url"
          value={settings.endpoint}
          aria-invalid={!!form.formState.errors.endpoint}
          onChange={(event) => change("endpoint", event.target.value)}
          placeholder="https://api.example.com/v1/chat/completions"
          spellCheck={false}
        />
        <FieldError errors={[form.formState.errors.endpoint]} />
        <span className="block text-[12px] leading-relaxed text-content/45">
          {t(
            "Full OpenAI-compatible Chat Completions URL. HTTP is supported for localhost.",
          )}
        </span>
      </label>
      <label className="block space-y-1 text-[12px] text-content/65">
        <span>{t("Title model ID")}</span>
        <Input
          className={fieldClass}
          value={settings.model}
          aria-invalid={!!form.formState.errors.model}
          onChange={(event) => change("model", event.target.value)}
          spellCheck={false}
        />
        <FieldError errors={[form.formState.errors.model]} />
      </label>
      <label className="block space-y-1 text-[12px] text-content/65">
        <span>{t("API key")}</span>
        <Input
          className={fieldClass}
          type="password"
          autoComplete="new-password"
          value={key}
          disabled={clearKey}
          onChange={(event) => {
            change("key", event.target.value);
            setNotice("");
          }}
          placeholder={
            read.data?.hasApiKey
              ? t("Saved; leave blank to keep")
              : t("Optional for local models")
          }
        />
        <span className="block text-[12px] leading-relaxed text-content/45">
          {t(
            "Stored only on the selected Host. The saved key is never sent back to this form.",
          )}
        </span>
      </label>
      <label className="flex items-center gap-2 text-[13px] text-content">
        <Checkbox
          disabled={!read.data?.hasApiKey}
          checked={clearKey}
          onCheckedChange={(checked) => {
            change("clearKey", checked === true);
            setNotice("");
          }}
        />
        {t("Remove saved API key")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary"
          disabled={!dirty || busy || loading || !loaded}
          type="submit"
        >
          {t("Save")}
        </Button>
        <Button variant="secondary"
          disabled={dirty || busy || loading || !loaded || !settings.enabled}
          onClick={() => void test()}
        >
          {testing ? t("Testing connection…") : t("Test connection")}
        </Button>
      </div>
      {dirty && (
        <p className="text-[12px] leading-relaxed text-content/45">
          {t("Save changes before testing the connection.")}
        </p>
      )}
      {loading && (
        <p className="text-[12px] text-content/45">{t("Loading…")}</p>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-danger/90">
          {errorText(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[12px] text-content/65">
          {notice}
        </p>
      )}
    </fieldset>
    </form>
  );
}
