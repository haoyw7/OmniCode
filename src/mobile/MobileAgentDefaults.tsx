import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import {
  DEFAULT_RUNTIME_MODE,
  HARNESS_TITLE,
  RUNTIME_MODES,
  RUNTIME_MODE_LABEL,
} from "../features/sessions/model/session";
import { RuntimeModeIcon } from "../features/sessions/ui/RuntimeModeIcon";
import type {
  HostModelCatalog,
  HostProviderAccounts,
} from "../features/connections/model/protocol";
import { MobileSettingsIcon as SettingsIcon } from "./MobileSettingsIcon";
import { MobileSelect } from "./MobileSelect";
import { SHEET_WIDTH } from "./MobileSheet";
import {
  configurationLabels,
  MobileModelControls,
  type MobileConfiguration,
} from "./MobileModelControls";
import {
  accountChoices,
  configurationForAgent,
  confirmLegacyAccounts,
  defaultConfiguration,
  loadMobileAgentDefaults,
  saveMobileAgentDefaults,
  withDefaultAccount,
  withDefaultConfiguration,
  type MobileAgentDefaults as Defaults,
  type MobileDefaultsHost,
} from "./agentDefaults";
import type { MobilePreferencePanel } from "./mobileSettingsRoutes";
import type { MobileClient } from "./client";
import { MobileAgentDefaultsStatus } from "./MobileAgentDefaultsStatus";
import { usePreferenceState } from "../features/settings/model/usePreferenceState";

/** Mounted in Settings only; discovery never holds up Home or a conversation. */
export function MobileAgentDefaults({
  client,
  hostId,
  disabled,
  panel,
  onPanelChange,
}: {
  client: MobileClient;
  hostId?: MobileDefaultsHost;
  disabled: boolean;
  panel: MobilePreferencePanel;
  onPanelChange: (panel: MobilePreferencePanel) => void;
}) {
  const { t } = useTranslation();
  const [defaults, setDefaults] = usePreferenceState<Defaults>(() =>
    loadMobileAgentDefaults(hostId),
  );
  const [catalog, setCatalog] = useState<HostModelCatalog>();
  const [accounts, setAccounts] = useState<HostProviderAccounts | null>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [retry, setRetry] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const hostKey = typeof hostId === "object"
    ? `${hostId.endpoint}\n${hostId.environmentId ?? ""}`
    : hostId;
  useEffect(() => {
    let current = true;
    setDefaults(loadMobileAgentDefaults(hostId));
    setCatalog(hostId ? client.cachedModels() : undefined);
    setAccounts(undefined);
    setCatalogError("");
    setAccountsError("");
    setCatalogLoading(!!hostId);
    setAccountsLoading(!!hostId);
    if (!hostId) return;
    void (async () => {
      try {
        const value = await client.models(undefined, retry > 0);
        if (current) setCatalog(value);
      } catch (error) {
        if (current)
          setCatalogError(
            error instanceof Error
              ? error.message
              : t("Unable to load models."),
          );
      } finally {
        if (current) setCatalogLoading(false);
      }
    })();
    void (async () => {
      try {
        const value = await client.providerAccounts();
        if (!current) return;
        setAccounts(value);
        if (value) {
          // Read the latest preferences so discovery cannot undo a local edit.
          const saved = loadMobileAgentDefaults(hostId);
          const confirmed = confirmLegacyAccounts(saved, value);
          if (confirmed !== saved) saveMobileAgentDefaults(hostId, confirmed);
          setDefaults(confirmed);
        }
      } catch (error) {
        if (current)
          setAccountsError(
            error instanceof Error
              ? error.message
              : t("Unable to load accounts."),
          );
      } finally {
        if (current) setAccountsLoading(false);
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hostKey, retry]);
  const change = (next: Defaults) => {
    if (!hostId || disabled) return;
    saveMobileAgentDefaults(hostId, next);
    setDefaults(next);
  };
  const saved = defaults.harness
    ? defaults.agents?.[defaults.harness]
    : undefined;
  const runtimeMode = defaults.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const resolved = catalog && defaultConfiguration(catalog, defaults);
  const configuration: MobileConfiguration = resolved ?? {
    harness: defaults.harness ?? "codex",
    model: saved?.model ?? "",
    modelSettings: saved?.modelSettings ?? {},
    runtimeMode,
  };
  const { modelName, effort } = configurationLabels(catalog, configuration);
  const summary = resolved
    ? [HARNESS_TITLE[configuration.harness], modelName, effort && t(effort)]
        .filter((part, index, parts) => part && parts.indexOf(part) === index)
        .join(" · ")
    : t(catalogLoading ? "Loading…" : "No models available");
  const unavailable = disabled || !hostId;
  return (
    <section
      className="mobile-settings-group"
      aria-label={t("New conversations")}
    >
      <h2>{t("New conversations")}</h2>
      <div className="mobile-settings-card">
        <button
          ref={trigger}
          type="button"
          className="mobile-settings-row"
          aria-haspopup="dialog"
          aria-expanded={panel === "agent-defaults"}
          disabled={unavailable || !resolved}
          onClick={() => onPanelChange("agent-defaults")}
        >
          <SettingsIcon name="agent" />
          <span className="mobile-settings-label">
            <span>{t("Agent and model")}</span>
            <small>{summary}</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <div className="mobile-settings-row mobile-settings-row-stacked">
          <span className="mobile-settings-icon" aria-hidden="true">
            <RuntimeModeIcon mode={runtimeMode} size={24} />
          </span>
          <label
            className="mobile-settings-label"
            htmlFor="mobile-default-permissions"
          >
            <span>{t("Default permissions")}</span>
          </label>
          <MobileSelect
            id="mobile-default-permissions"
            label={t("Default permissions")}
            sheetWidth={SHEET_WIDTH.list}
            value={runtimeMode}
            open={panel === "default-permissions"}
            disabled={unavailable}
            onOpenChange={(open) =>
              onPanelChange(open ? "default-permissions" : null)
            }
            onChange={(mode) => change({ ...defaults, runtimeMode: mode })}
            options={RUNTIME_MODES.map((mode) => ({
              value: mode,
              label: t(RUNTIME_MODE_LABEL[mode]),
              icon: <RuntimeModeIcon mode={mode} size={22} />,
            }))}
          />
        </div>
        {accountChoices(accounts ?? undefined, defaults).map(
          ({ agent, accounts: options }) => {
            const panelId = `account-${agent}` as const;
            const selected = defaults.agents?.[agent]?.accountId ?? "default";
            const missing = !options.some((account) => account.id === selected);
            const needsConfirmation =
              defaults.agents?.[agent]?.accountNeedsConfirmation;
            return (
              <div
                key={agent}
                className="mobile-settings-row mobile-settings-row-stacked"
              >
                <SettingsIcon name="account" />
                <label
                  className="mobile-settings-label"
                  htmlFor={`mobile-${panelId}`}
                >
                  <span>
                    {t("{agent} account", { agent: HARNESS_TITLE[agent] })}
                  </span>
                  {needsConfirmation && (
                    <small>
                      {t(
                        "Verify this account on the current Host or choose another account.",
                      )}
                    </small>
                  )}
                </label>
                <MobileSelect
                  id={`mobile-${panelId}`}
                  sheetWidth={SHEET_WIDTH.list}
                  label={t("{agent} account", { agent: HARNESS_TITLE[agent] })}
                  value={selected}
                  open={panel === panelId}
                  disabled={
                    unavailable ||
                    accountsLoading ||
                    !accounts ||
                    !!accountsError
                  }
                  onOpenChange={(open) => onPanelChange(open ? panelId : null)}
                  onChange={(id) =>
                    change(withDefaultAccount(defaults, agent, id))
                  }
                  options={[
                    ...(missing
                      ? [
                          {
                            value: selected,
                            label: t("Unavailable account ({account})", {
                              account: selected,
                            }),
                            disabled: true,
                          },
                        ]
                      : []),
                    ...options.map((account) => ({
                      value: account.id,
                      label: account.id === "default" && (account.defaultAccountId || account.defaultError)
                        ? account.defaultError
                          ? t("Host default unavailable")
                          : t("Follow Host default: {account}", { account: [
                            account.defaultAccountLabel === "Default account" ? t("Host CLI account") : account.defaultAccountLabel,
                            account.defaultIdentity?.email ?? account.defaultIdentity?.name,
                          ].filter(Boolean).join(" · ") })
                        : [account.id === "default" && account.label === "Default account" ? t("Default account") : account.label,
                          account.identity?.email ?? account.identity?.name].filter(Boolean).join(" · "),
                    })),
                  ]}
                />
              </div>
            );
          },
        )}
      </div>
      <p className="mobile-settings-footer">
        {t(
          "Defaults for new conversations on this phone, saved separately for each Host. Accounts are managed on your computer.",
        )}
      </p>
      {!hostId ? (
        <p className="mobile-settings-footer">
          {t("Connect to a Host to choose defaults.")}
        </p>
      ) : accountsLoading ? (
        <p className="mobile-settings-footer" role="status">
          {t("Loading accounts…")}
        </p>
      ) : accounts === null ? (
        <p className="mobile-settings-footer">
          {t("Provider accounts are unavailable on this Host.")}
        </p>
      ) : null}
      <MobileAgentDefaultsStatus
        catalog={catalog}
        catalogError={catalogError}
        accounts={accounts}
        accountsError={accountsError}
        defaults={defaults}
        harness={configuration.harness}
        loading={catalogLoading || accountsLoading}
        disabled={unavailable}
        onRetry={() => setRetry((value) => value + 1)}
      />
      <MobileModelControls
        open={panel === "agent-defaults" && !unavailable}
        catalog={catalog}
        loading={catalogLoading}
        configuration={configuration}
        lockedAgent={false}
        disabled={unavailable}
        agentConfiguration={(agent) =>
          catalog && configurationForAgent(catalog, defaults, agent)
        }
        onChange={(next) => change(withDefaultConfiguration(defaults, next))}
        onClose={() => onPanelChange(null)}
        preserveFocus={trigger}
      />
    </section>
  );
}
