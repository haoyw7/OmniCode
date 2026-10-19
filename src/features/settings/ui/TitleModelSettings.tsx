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
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { Button } from "../../../shared/ui/forms/Button";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";

const fieldClass =
  "h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2.5 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-input-border-hover disabled:opacity-50";

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
      <button
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
      </button>
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
  const [settings, setSettings] = useState(DEFAULT_TITLE_MODEL);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    void remoteRequest<TitleModelStatus>(machineId, "titleModel.status")
      .then((value) => {
        if (active) {
          setSettings(value);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [machineId]);

  function change(update: Partial<TitleModelStatus>) {
    setSettings((current) => ({ ...current, ...update }));
    setDirty(true);
    setNotice("");
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const update: TitleModelUpdate = {
        enabled: settings.enabled,
        endpoint: settings.endpoint,
        model: settings.model,
        ...(clearKey
          ? { apiKey: "" }
          : key.trim()
            ? { apiKey: key.trim() }
            : {}),
      };
      setSettings(
        await withStatusToast(
          () => remoteRequest<TitleModelStatus>(machineId, "titleModel.save", update),
          { loading: t("Saving…"), success: t("Saved"), error: false },
        ),
      );
      setKey("");
      setClearKey(false);
      setDirty(false);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await remoteRequest<GeneratedSessionTitle | null>(
        machineId,
        "titleModel.test",
      );
      setNotice(
        result
          ? t("Connection successful: {title}", { title: result.title })
          : t("Title generation is disabled."),
      );
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
      setTesting(false);
    }
  }
  return (
    <fieldset disabled={loading || busy || !loaded} className="space-y-3">
      <label className="flex items-center gap-2 text-[13px] text-content">
        <input data-ui="checkbox"
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
        />
        {t("Generate titles with model API")}
      </label>
      <label className="block space-y-1 text-[12px] text-content/65">
        <span>{t("Chat Completions endpoint")}</span>
        <Input
          className={fieldClass}
          type="url"
          value={settings.endpoint}
          onChange={(event) => change({ endpoint: event.target.value })}
          placeholder="https://api.example.com/v1/chat/completions"
          spellCheck={false}
        />
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
          onChange={(event) => change({ model: event.target.value })}
          spellCheck={false}
        />
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
            setKey(event.target.value);
            setDirty(true);
            setNotice("");
          }}
          placeholder={
            settings.hasApiKey
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
        <input data-ui="checkbox"
          type="checkbox"
          disabled={!settings.hasApiKey}
          checked={clearKey}
          onChange={(event) => {
            setClearKey(event.target.checked);
            setDirty(true);
            setNotice("");
          }}
        />
        {t("Remove saved API key")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary"
          disabled={!dirty || busy || loading || !loaded}
          onClick={() => void save()}
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
        <p role="alert" className="text-[12px] text-red-400/90">
          {errorText(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[12px] text-content/65">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
