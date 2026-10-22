import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries } from "@tanstack/react-query";
import {
  parseAsJson,
  parseAsInteger,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { z } from "zod";
import { toast } from "sonner";
import {
  USAGE_CONTRACT_VERSION,
  USAGE_PROVIDERS,
  type UsageLimitSource,
  type UsageProvider,
} from "../../../integrations/harness/core/usage";
import type {
  UsageTransport,
  UsageSettingsPatch,
} from "../model/usageTransport";
import { usageView, usageWindow, type UsageModelRow } from "../model/usage";
import { mergeUsageSummaries } from "../model/usageMerge";
import {
  useUsagePreferences,
  type UsageMetric,
} from "../model/usagePreferences";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  queryClient,
  invalidateAfterChange,
} from "../../../shared/lib/queryClient";
import { Button } from "../../../shared/ui/forms/Button";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Checkbox } from "../../../shared/ui/forms/Checkbox";
import { RefreshCw, ListFilter, ChevronRight } from "../../../shared/ui/icons";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../../shared/ui/primitives/Tabs";
import { Empty, EmptyTitle } from "../../../shared/ui/primitives/Empty";
import { Skeleton } from "../../../shared/ui/primitives/Skeleton";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { UsageOverview } from "./UsageOverview";
import { UsageLimits } from "./UsageLimits";
import { UsageChart } from "./UsageCharts";
import type { UsageDialogRenderer } from "./usageDialog";
import { useInlineBreakpoints } from "../../../shared/hooks/useInlineBreakpoints";

export interface UsageSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}
type Detail =
  | { kind: "environments" | "providers" | "sources" | "unpriced" }
  | { kind: "model"; row: UsageModelRow }
  | { kind: "reset"; account: UsageLimitSource };
const listParser = parseAsJson((value) => z.array(z.string()).parse(value));
const BREAKPOINTS = [900, 1200];
export function UsageDashboard({
  environments,
  mobile = false,
  active = true,
  icon,
  select,
  dialog,
  toolbar,
  onClose,
  onRefreshReady,
}: {
  environments: UsageTransport[];
  mobile?: boolean;
  active?: boolean;
  icon: (provider: UsageProvider) => ReactNode;
  select: (props: UsageSelectProps) => ReactNode;
  dialog: UsageDialogRenderer;
  toolbar?: (controls: ReactNode) => ReactNode;
  onClose?: () => void;
  onRefreshReady?: (refresh: () => void) => void;
}) {
  const { t, language } = useTranslation(),
    visible = useSurfaceVisibility();
  const layoutRef = useInlineBreakpoints(BREAKPOINTS, "px", !mobile);
  const preferences = useUsagePreferences();
  const [metric, setMetric] = useQueryState(
    "usageView",
    parseAsStringLiteral(["cost", "tokens", "limits"]).withDefault(
      mobile ? "limits" : preferences.metric,
    ),
  );
  const [days, setDays] = useQueryState(
    "usageDays",
    parseAsInteger.withDefault(preferences.days),
  );
  const [selectedIds, setSelectedIds] = useQueryState(
    "usageEnvironments",
    listParser.withDefault([]),
  );
  const [detail, setDetail] = useState<Detail | null>(null),
    [refreshVersion, setRefreshVersion] = useState(0);
  const previousMetric = useRef<"cost" | "tokens">("cost");
  if (metric !== "limits") previousMetric.current = metric;
  const validDays = [1, 7, 30, 90].includes(days) ? days : 30;
  const input = useMemo(
    () => usageWindow(validDays),
    [validDays, refreshVersion],
  );
  const selected = environments.filter(
    (environment) =>
      environment.enabled &&
      (!selectedIds.length || selectedIds.includes(environment.sourceKey)),
  );
  const hidden = mobile ? [] : preferences.hidden;
  const showHistory =
    metric !== "limits" ||
    detail?.kind === "sources" ||
    detail?.kind === "model";
  const force = useRef(new Set<string>());
  const summaryQueries = useQueries(
    {
      queries: environments.map((environment) => ({
        queryKey: ["usage", environment.sourceKey, "summary", input],
        staleTime: 60_000,
        enabled:
          visible && active && selected.includes(environment) && showHistory,
        placeholderData: (
          old:
            | import("../../../integrations/harness/core/usage").UsageSummary
            | undefined,
          query: { queryKey: readonly unknown[] } | undefined,
        ) => (query?.queryKey[1] === environment.sourceKey ? old : undefined),
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const key = `${environment.sourceKey}:summary`,
            refresh = force.current.delete(key);
          const value = await environment.summary({ ...input, refresh });
          signal.throwIfAborted();
          if (value.contractVersion !== USAGE_CONTRACT_VERSION)
            throw new Error(
              "This Host uses an incompatible usage format. Update and restart it.",
            );
          return value;
        },
      })),
    },
    queryClient,
  );
  const limitQueries = useQueries(
    {
      queries: environments.map((environment) => ({
        queryKey: ["usage", environment.sourceKey, "limits"],
        staleTime: 300_000,
        enabled:
          visible &&
          active &&
          selected.includes(environment) &&
          metric === "limits",
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const value = await environment.limits(
            force.current.delete(`${environment.sourceKey}:limits`),
          );
          signal.throwIfAborted();
          return value;
        },
      })),
    },
    queryClient,
  );
  const progressQueries = useQueries(
    {
      queries: environments.map((environment, index) => ({
        queryKey: ["usage", environment.sourceKey, "progress"],
        enabled:
          visible &&
          active &&
          !!environment.progress &&
          summaryQueries[index].isFetching,
        refetchInterval: summaryQueries[index].isFetching
          ? 1000
          : (false as const),
        queryFn: () => environment.progress!(),
      })),
    },
    queryClient,
  );
  const indexes = environments
    .map((environment, index) => (selected.includes(environment) ? index : -1))
    .filter((index) => index >= 0);
  const summaries = indexes.flatMap((index) =>
    summaryQueries[index].data ? [summaryQueries[index].data!] : [],
  );
  const merged = mergeUsageSummaries(summaries);
  const limits = indexes.flatMap((index) =>
    (limitQueries[index].data ?? []).map((source) => ({
      ...source,
      environmentKey: environments[index].sourceKey,
      environmentLabel:
        environments[index].label ?? environments[index].sourceKey,
    })),
  );
  const queries = metric === "limits" ? limitQueries : summaryQueries;
  const fetching = indexes.some((index) => queries[index].isFetching);
  const pending =
    indexes.some(
      (index) => queries[index].isPending && !queries[index].isError,
    ) && indexes.every((index) => !queries[index].data);
  const refresh = () => {
    if (validDays === 1 && metric !== "limits") {
      for (const environment of selected)
        force.current.add(`${environment.sourceKey}:summary`);
      setRefreshVersion((version) => version + 1);
    } else
      for (const index of indexes) {
        force.current.add(
          `${environments[index].sourceKey}:${metric === "limits" ? "limits" : "summary"}`,
        );
        void queries[index].refetch();
      }
  };
  useEffect(() => {
    onRefreshReady?.(() => {
      if (!fetching) refresh();
    });
  });
  const update = useMutation(
    {
      mutationFn: async ({
        patch,
        keys,
      }: {
        patch: UsageSettingsPatch;
        keys: string[];
      }) => {
        const destinations = environments.filter((environment) =>
          keys.includes(environment.sourceKey),
        );
        if (!destinations.length)
          throw new Error("Choose at least one environment.");
        const results = await Promise.allSettled(
          destinations.map((environment) => environment.update(patch)),
        );
        await Promise.all(
          destinations.map((environment) =>
            invalidateAfterChange(["usage", environment.sourceKey]),
          ),
        );
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Some environments could not save usage settings.");
      },
      onSuccess: () => toast.success(t("Usage settings saved")),
      onError: (error) => toast.error(t(error.message)),
    },
    queryClient,
  );
  const reset = useMutation(
    {
      mutationFn: async (source: UsageLimitSource) => {
        const environment = environments.find(
          (environment) => environment.sourceKey === source.environmentKey,
        );
        if (!environment?.reset || !source.accountId)
          throw new Error("This Host does not support Codex usage resets.");
        const result = await environment.reset(source.accountId);
        await invalidateAfterChange(["usage", environment.sourceKey]);
        return result;
      },
      onSuccess: (result) => {
        const outcome = (result as { outcome?: string })?.outcome;
        toast.success(
          t(
            outcome === "noCredit"
              ? "No banked resets are available."
              : outcome === "nothingToReset"
                ? "There’s no active usage to reset."
                : "Usage reset request completed.",
          ),
        );
      },
      onError: () => toast.error(t("Unable to use the reset credit.")),
    },
    queryClient,
  );
  const chooseMetric = (next: UsageMetric) => {
    void setMetric(next);
    if (!mobile) preferences.save({ metric: next });
  };
  const chooseDays = (next: number) => {
    void setDays(next);
    preferences.save({ days: next });
  };
  useEffect(() => {
    if (mobile || !visible || !active) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"], .omnicode-terminal',
          )) ||
        document.querySelector(
          '[role="dialog"], [role="menu"], [data-state="open"][role="listbox"]',
        )
      )
        return;
      let handled = true;
      const rangeKey = /^Digit[1-4]$/.test(event.code)
        ? event.code.slice(-1)
        : event.key;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        /^[1-4]$/.test(rangeKey) &&
        metric !== "limits"
      )
        chooseDays([1, 7, 30, 90][Number(rangeKey) - 1]);
      else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const next = ({ c: "cost", t: "tokens", l: "limits" } as const)[
          event.key.toLowerCase() as "c"
        ];
        if (next) chooseMetric(next);
        else if (event.key === "Escape" && onClose) onClose();
        else handled = false;
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [mobile, visible, active, onClose, metric, setMetric, setDays]);
  const usd = (value: number) =>
    new Intl.NumberFormat(language, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  const control = (
    values: readonly string[],
    current: string,
    onChange: (value: string) => void,
    labels: readonly string[],
    disabled = false,
  ) => (
    <Tabs value={current} onValueChange={onChange}>
      <TabsList aria-label={t("Usage sections")}>
        {values.map((value, index) => (
          <TabsTrigger disabled={disabled} value={value} key={value}>
            {t(labels[index])}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  const envTitle =
    selected.length === 1
      ? (selected[0].label ?? t("Environment"))
      : t("{count} environments", { count: selected.length });
  const actions = (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        label={t("Filter environments")}
        onClick={() => setDetail({ kind: "environments" })}
      >
        <ListFilter />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        label={t("Refresh usage")}
        disabled={!selected.length || fetching}
        onClick={refresh}
      >
        <RefreshCw
          className={
            fetching ? "animate-spin motion-reduce:animate-none" : undefined
          }
        />
      </IconButton>
    </>
  );
  const modalContent = () => {
    if (!detail) return null;
    if (detail.kind === "environments")
      return (
        <fieldset className="usage-choice-list" aria-label={t("Environments")}>
          {environments.map((environment) => (
            <label key={environment.sourceKey}>
              <Checkbox
                checked={
                  !selectedIds.length ||
                  selectedIds.includes(environment.sourceKey)
                }
                disabled={!environment.enabled}
                onCheckedChange={(checked) => {
                  const current = selectedIds.length
                    ? selectedIds
                    : environments.map((environment) => environment.sourceKey);
                  const next = checked
                    ? [...new Set([...current, environment.sourceKey])]
                    : current.filter((key) => key !== environment.sourceKey);
                  void setSelectedIds(next.length ? next : ["none"]);
                }}
              />
              {environment.label ?? environment.sourceKey}
            </label>
          ))}
        </fieldset>
      );
    if (detail.kind === "providers")
      return (
        <fieldset className="usage-choice-list">
          <legend>{t("Visible providers")}</legend>
          {USAGE_PROVIDERS.map((id) => (
            <label key={id}>
              <Checkbox
                checked={!hidden.includes(id)}
                onCheckedChange={(checked) =>
                  preferences.save({
                    hidden: checked
                      ? hidden.filter((value) => value !== id)
                      : [...hidden, id],
                  })
                }
              />
              {icon(id)}
              {HARNESS_TITLE[id]}
            </label>
          ))}
        </fieldset>
      );
    if (detail.kind === "unpriced")
      return (
        <p>
          {t(
            "Records without known prices are included in token totals and excluded from API cost estimates.",
          )}
        </p>
      );
    if (detail.kind === "reset")
      return (
        <div className="usage-account-detail">
          <p>{t("Use one banked reset credit for this account?")}</p>
          <p>
            {detail.account.label} · {detail.account.environmentLabel}
          </p>
          <Button
            disabled={reset.isPending}
            onClick={() => {
              reset.mutate(detail.account);
              setDetail(null);
            }}
          >
            {t("Use reset")}
          </Button>
        </div>
      );
    if (detail.kind === "sources")
      return (
        <div>
          {merged.sources.map((source) => (
            <div className="usage-source" key={source.id}>
              <div className="usage-model">
                {icon(source.provider)}
                <strong>{HARNESS_TITLE[source.provider]}</strong>
                <span>
                  {t(
                    {
                      ok: "Ready",
                      missing: "Not found",
                      partial: "Partial",
                      failed: "Unavailable",
                    }[source.status],
                  )}
                </span>
              </div>
              <code>{source.path}</code>
              <small>
                {t("Files")}: {source.scannedFiles} · {t("Malformed records")}:{" "}
                {source.malformedRecords}
              </small>
              {source.message ? <p>{t(source.message)}</p> : null}
            </div>
          ))}
        </div>
      );
    if (detail.kind !== "model") return null;
    const row = detail.row,
      own = merged.buckets.filter(
        (bucket) =>
          bucket.provider === row.provider && bucket.model === row.model,
      ),
      view = usageView(own),
      inputTokens =
        row.totals.uncachedInputTokens +
        row.totals.cachedInputTokens +
        row.totals.cacheCreationTokens;
    return (
      <div className="usage-model-detail">
        <UsageChart
          buckets={own}
          metric={metric === "tokens" ? "tokens" : "cost"}
          mobile={false}
          from={input.sinceTime ?? input.sinceDay}
          to={input.untilTime ?? input.untilDay}
          format={
            metric === "tokens"
              ? (value) => value.toLocaleString(language)
              : usd
          }
        />
        <p>
          {t("Cache hit")}:{" "}
          {(inputTokens
            ? (row.totals.cachedInputTokens / inputTokens) * 100
            : 0
          ).toFixed(1)}
          %
        </p>
        <p>
          {t("Effective USD per million tokens")}:{" "}
          {usd(row.tokens ? (row.costUsd / row.tokens) * 1_000_000 : 0)}
        </p>
        <p>
          {t("Cache savings")}: {usd(view.savings)}
        </p>
      </div>
    );
  };
  const title = !detail
    ? ""
    : detail.kind === "model"
      ? detail.row.model
      : {
          environments: "Environments",
          providers: "Providers",
          sources: "Sources",
          unpriced: "Unpriced records",
          reset: "Use reset",
        }[detail.kind];
  return (
    <div
      ref={layoutRef}
      className={`usage-dashboard${mobile ? " usage-mobile" : ""}`}
      aria-busy={fetching || update.isPending}
      data-updating={fetching || undefined}
    >
      <header className="usage-toolbar">
        {!mobile ? (
          <nav className="usage-breadcrumb" aria-label={t("Usage")}>
            <strong>{t("Usage")}</strong>
            <ChevronRight />
            <Button
              variant="ghost"
              onClick={() => setDetail({ kind: "environments" })}
            >
              {envTitle}
            </Button>
            <ChevronRight />
            <Button
              variant="ghost"
              onClick={() => setDetail({ kind: "providers" })}
            >
              {hidden.length
                ? t("{count} providers", {
                    count: USAGE_PROVIDERS.length - hidden.length,
                  })
                : t("All providers")}
            </Button>
          </nav>
        ) : null}
        {!mobile ? (
          <div className="usage-desktop-controls">
            <div className="usage-wide-control">
              {control(
                ["cost", "tokens", "limits"],
                metric,
                (value) => chooseMetric(value as UsageMetric),
                ["Cost", "Tokens", "Limits"],
              )}
            </div>
            <div className="usage-narrow-control">
              {select({
                label: t("Metric"),
                value: metric,
                onChange: (value) => chooseMetric(value as UsageMetric),
                options: ["cost", "tokens", "limits"].map((value, index) => ({
                  value,
                  label: t(["Cost", "Tokens", "Limits"][index]),
                })),
              })}
            </div>
            <div className="usage-wide-control">
              {control(
                ["1", "7", "30", "90"],
                String(validDays),
                (value) => {
                  if (metric !== "limits") chooseDays(Number(value));
                },
                ["Past 24h", "7 days", "30 days", "90 days"],
                metric === "limits",
              )}
            </div>
            <div className="usage-narrow-control">
              {select({
                label: t("Date range"),
                value: String(validDays),
                disabled: metric === "limits",
                onChange: (value) => chooseDays(Number(value)),
                options: [1, 7, 30, 90].map((value, index) => ({
                  value: String(value),
                  label: t(["Past 24h", "7 days", "30 days", "90 days"][index]),
                })),
              })}
            </div>
            {actions}
          </div>
        ) : toolbar ? (
          toolbar(actions)
        ) : (
          <div className="usage-mobile-actions">{actions}</div>
        )}
      </header>
      {mobile ? (
        <>
          {control(
            ["usage", "limits"],
            metric === "limits" ? "limits" : "usage",
            (value) =>
              chooseMetric(
                value === "limits" ? "limits" : previousMetric.current,
              ),
            ["Usage", "Limits"],
          )}
          {metric !== "limits" ? (
            <div className="usage-mobile-controls">
              {control(
                ["1", "7", "30", "90"],
                String(validDays),
                (value) => chooseDays(Number(value)),
                ["24h", "7d", "30d", "90d"],
              )}
              {control(
                ["cost", "tokens"],
                metric,
                (value) => chooseMetric(value as UsageMetric),
                ["Cost", "Tokens"],
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {fetching ? (
        <p className="usage-updating-label" role="status">
          {t("Updating usage…")}{" "}
          {indexes
            .flatMap(
              (index) =>
                progressQueries[index].data?.providers.map(
                  (provider) => HARNESS_TITLE[provider],
                ) ?? [],
            )
            .join(", ") ||
            selected.map((environment) => environment.label).join(", ")}
        </p>
      ) : null}
      {indexes.map((index) =>
        queries[index].isError ? (
          <div key={index} role="alert" className="usage-error">
            <span>
              {environments[index].label}:{" "}
              {t(
                queries[index].error.message.replace(
                  /^Host rejected request: /,
                  "",
                ),
              )}
            </span>
            <Button variant="ghost" onClick={refresh}>
              {t("Retry")}
            </Button>
          </div>
        ) : null,
      )}
      {!selected.length ? (
        <Empty>
          <EmptyTitle>
            {t(
              environments.length
                ? "Choose at least one environment."
                : "Connect to a Host to view usage.",
            )}
          </EmptyTitle>
        </Empty>
      ) : pending ? (
        <div className="usage-skeleton" role="status">
          <span className="sr-only">{t("Loading…")}</span>
          {[1, 2, 3, 4].map((id) => (
            <Skeleton key={id} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="usage-data">
          {merged.duplicateSources ? (
            <p className="usage-muted">
              {t(
                "Duplicate history sources are counted once across environments.",
              )}
            </p>
          ) : null}
          {metric === "limits" ? (
            <UsageLimits
              sources={limits}
              icon={icon}
              dialog={dialog}
              onReset={(account) => setDetail({ kind: "reset", account })}
              onEnableCursor={() =>
                update.mutate({
                  patch: { cursorKeychainEnabled: true },
                  keys: selected.map((environment) => environment.sourceKey),
                })
              }
            />
          ) : (
            <>
              <UsageOverview
                data={merged}
                metric={metric}
                mobile={mobile}
                hidden={hidden}
                input={input}
                icon={icon}
                onModel={
                  mobile
                    ? undefined
                    : (row) => setDetail({ kind: "model", row })
                }
                onUnpriced={() => setDetail({ kind: "unpriced" })}
              />
              {merged.sources.some(
                (source) =>
                  source.provider === "cursor" &&
                  source.message?.startsWith("Enable Cursor"),
              ) ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    update.mutate({
                      patch: { cursorKeychainEnabled: true },
                      keys: selected.map(
                        (environment) => environment.sourceKey,
                      ),
                    })
                  }
                >
                  {t("Enable Cursor Keychain access")}
                </Button>
              ) : null}
              {merged.sources.some(
                (source) =>
                  source.status === "partial" || source.status === "failed",
              ) ? (
                <p className="usage-notice">
                  {t(
                    "Some usage sources are unavailable. Totals may be incomplete.",
                  )}
                  {!mobile ? (
                    <Button
                      variant="link"
                      onClick={() => setDetail({ kind: "sources" })}
                    >
                      {t("Sources")}
                    </Button>
                  ) : null}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
      {dialog(
        detail
          ? {
              title: detail.kind === "model" ? title : t(title),
              size:
                detail.kind === "model"
                  ? "lg"
                  : detail.kind === "sources"
                    ? "md"
                    : "sm",
              onClose: () => setDetail(null),
              children: modalContent(),
            }
          : null,
      )}
    </div>
  );
}
