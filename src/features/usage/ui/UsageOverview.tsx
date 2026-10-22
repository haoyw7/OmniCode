import { useMemo, type ReactNode } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import {
  totalTokens,
  USAGE_PROVIDERS,
  type UsageBucket,
  type UsageProvider,
} from "../../../integrations/harness/core/usage";
import { usageView, type UsageModelRow } from "../model/usage";
import type { mergeUsageSummaries } from "../model/usageMerge";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  DataTable,
  dataTableFeatures,
} from "../../../shared/ui/primitives/DataTable";
import { Button } from "../../../shared/ui/forms/Button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../../shared/ui/primitives/Tabs";
import { Info } from "../../../shared/ui/icons";
import {
  Empty,
  EmptyTitle,
  EmptyDescription,
} from "../../../shared/ui/primitives/Empty";
import { VirtualRows } from "../../../shared/ui/VirtualRows";
import { ListMotion, ListMotionItem } from "../../../shared/ui/ListMotion";
import { UsageChart, UsageShareBar, usageColor } from "./UsageCharts";

const column = createColumnHelper<typeof dataTableFeatures, UsageModelRow>();
export function UsageOverview({
  data,
  metric,
  mobile,
  hidden,
  input,
  icon,
  onModel,
  onUnpriced,
}: {
  data: ReturnType<typeof mergeUsageSummaries>;
  metric: "cost" | "tokens";
  mobile: boolean;
  hidden: readonly string[];
  input: {
    sinceDay: string;
    untilDay: string;
    sinceTime?: string;
    untilTime?: string;
  };
  icon: (provider: UsageProvider) => ReactNode;
  onModel?: (row: UsageModelRow) => void;
  onUnpriced: () => void;
}) {
  const { t, language } = useTranslation();
  const [breakdown, setBreakdown] = useQueryState(
    "usageBreakdown",
    parseAsStringLiteral(["model", "time"]).withDefault("model"),
  );
  const view = useMemo(
    () => usageView(data.buckets, hidden),
    [data.buckets, hidden],
  );
  const usd = (value: number) =>
    new Intl.NumberFormat(language, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    }).format(value);
  const count = (value: number) =>
    new Intl.NumberFormat(language, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const format = metric === "cost" ? usd : count,
    total = metric === "cost" ? view.cost : totalTokens(view.totals);
  const buckets = data.buckets.filter(
    (bucket) => !hidden.includes(bucket.provider),
  );
  const providers = USAGE_PROVIDERS.filter((id) => !hidden.includes(id))
    .map((id) => {
      const own = buckets.filter((bucket) => bucket.provider === id),
        value = own.reduce(
          (sum, bucket) =>
            sum +
            (metric === "cost" ? bucket.costUsd : totalTokens(bucket.totals)),
          0,
        );
      return {
        id,
        value,
        sessions: data.providerSessions[id] ?? 0,
        exists: own.length > 0,
      };
    })
    .filter(
      (provider) =>
        provider.exists ||
        data.sources.some(
          (source) =>
            source.provider === provider.id && source.status !== "missing",
        ),
    )
    .sort((a, b) => b.value - a.value);
  const models = [...view.models].sort((a, b) =>
    metric === "cost" ? b.costUsd - a.costUsd : b.tokens - a.tokens,
  );
  const max = Math.max(
    ...models.map((row) => (metric === "cost" ? row.costUsd : row.tokens)),
    0.000001,
  );
  const columns = useMemo(
    () => [
      column.display({
        id: "rank",
        header: "#",
        cell: ({ row }) => row.index + 1,
      }),
      column.display({
        id: "model",
        header: t("Model"),
        cell: ({ row }) => (
          <div className="usage-model-cell">
            <span className="usage-model">
              {icon(row.original.provider)}
              <span className="usage-model-name">{row.original.model}</span>
            </span>
            <span
              className="usage-model-peak"
              style={{
                width: `${((metric === "cost" ? row.original.costUsd : row.original.tokens) / max) * 100}%`,
                background: usageColor(row.original.provider),
              }}
            />
          </div>
        ),
      }),
      column.accessor("costUsd", {
        header: t("Cost"),
        cell: (cell) => usd(cell.getValue()),
      }),
      column.display({
        id: "share",
        header: t("Share"),
        cell: ({ row }) =>
          `${(total ? ((metric === "cost" ? row.original.costUsd : row.original.tokens) / total) * 100 : 0).toFixed(1)}%`,
      }),
      column.accessor("tokens", {
        header: t("Tokens"),
        cell: (cell) => count(cell.getValue()),
      }),
    ],
    [t, language, metric, max, total, icon],
  );
  const tokenSegments = [
    {
      label: t("Uncached input"),
      value: view.totals.uncachedInputTokens,
      color: "var(--color-agent-blue)",
    },
    {
      label: t("Cached input"),
      value: view.totals.cachedInputTokens,
      color: "var(--color-agent-teal)",
    },
    {
      label: t("Cache write"),
      value: view.totals.cacheCreationTokens,
      color: "var(--color-agent-violet)",
    },
    {
      label: t("Output"),
      value: view.totals.outputTokens,
      color: "var(--color-agent-orange)",
    },
  ];
  const costSegments = [
    {
      label: t("Uncached input"),
      value: view.category.input,
      color: "var(--color-agent-blue)",
    },
    {
      label: t("Cache read"),
      value: view.category.cacheRead,
      color: "var(--color-agent-teal)",
    },
    {
      label: t("Cache write"),
      value: view.category.cacheWrite,
      color: "var(--color-agent-violet)",
    },
    {
      label: t("Output"),
      value: view.category.output,
      color: "var(--color-agent-orange)",
    },
    {
      label: t("Other"),
      value: view.category.other,
      color: "var(--color-agent-amber)",
    },
  ];
  const providerRows = (
    <div className="usage-provider-rows">
      <ListMotion>
        {providers.map((provider) => (
          <ListMotionItem key={provider.id} className="usage-provider-row">
            <span className="usage-provider-label">
              <i style={{ background: usageColor(provider.id) }} />
              {icon(provider.id)}
              {HARNESS_TITLE[provider.id]}
            </span>
            {!mobile ? (
              <small>
                {t("{count} sessions", { count: provider.sessions })}
              </small>
            ) : null}
            <strong>{provider.exists ? format(provider.value) : "—"}</strong>
            <small>
              {(total ? (provider.value / total) * 100 : 0).toFixed(1)}%
            </small>
            {mobile ? (
              <div className="usage-provider-share">
                <span
                  style={{
                    width: `${total ? (provider.value / total) * 100 : 0}%`,
                    background: usageColor(provider.id),
                  }}
                />
              </div>
            ) : null}
          </ListMotionItem>
        ))}
      </ListMotion>
    </div>
  );
  const chart = (
    <UsageChart
      buckets={buckets}
      metric={metric}
      mobile={mobile}
      from={input.sinceTime ?? input.sinceDay}
      to={input.untilTime ?? input.untilDay}
      format={format}
    />
  );
  const headline = (
    <div className="usage-headline">
      <div>
        <strong>
          {format(total)}
          {mobile && metric === "cost" ? "*" : ""}
        </strong>
        {metric === "cost" && !mobile ? (
          <small>{t("API estimate")}</small>
        ) : null}
        {view.unpriced && !mobile ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Unpriced records")}
            onClick={onUnpriced}
          >
            <Info />
          </Button>
        ) : null}
      </div>
      <p>
        {t("{count} sessions", {
          count: hidden.length
            ? providers.reduce((sum, provider) => sum + provider.sessions, 0)
            : data.sessions,
        })}
      </p>
    </div>
  );
  const modelList = (row: UsageModelRow) => (
    <div className="usage-mobile-model">
      <span className="usage-model">
        {icon(row.provider)}
        <span className="usage-model-name">{row.model}</span>
      </span>
      <strong>{format(metric === "cost" ? row.costUsd : row.tokens)}</strong>
      <small>
        {count(row.tokens)} {t("tokens")}
        {row.unpricedRecords ? ` · ${t("Unpriced")}` : ""}
      </small>
    </div>
  );
  return (
    <>
      {mobile ? (
        <>
          <section className="usage-section usage-mobile-summary">
            {headline}
            {chart}
            {metric === "cost" ? (
              <p className="usage-api-footnote">
                {t("* if billed at full API rate")}
              </p>
            ) : null}
          </section>
          <section className="usage-section">
            <h2>{t("Providers")}</h2>
            {providerRows}
          </section>
        </>
      ) : (
        <section className="usage-hero">
          <div>
            {headline}
            {providerRows}
          </div>
          {chart}
        </section>
      )}
      <section className="usage-section usage-totals">
        <h2>{t("Totals")}</h2>
        <div className="usage-total-grid">
          {[
            ["Processed tokens", count(totalTokens(view.totals))],
            ["Cached input", count(view.totals.cachedInputTokens)],
            ["Uncached input", count(view.totals.uncachedInputTokens)],
            ["Output", count(view.totals.outputTokens)],
            ["Cache savings", usd(view.savings)],
            ...(mobile ? [["Unpriced", String(view.unpriced)]] : []),
          ].map(([label, value]) => (
            <div key={label}>
              <span>{t(label)}</span>
              <strong>{value}</strong>
              {label === "Output" && view.totals.reasoningTokens ? (
                <small>
                  {t("Includes {count} reasoning tokens", {
                    count: count(view.totals.reasoningTokens),
                  })}
                </small>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <section className="usage-section">
        <h2>{t(mobile || metric === "cost" ? "Cost" : "Tokens")}</h2>
        <UsageShareBar
          label={t("By type")}
          segments={
            metric === "tokens" && !mobile ? tokenSegments : costSegments
          }
          format={metric === "tokens" && !mobile ? count : usd}
        />
        {metric === "cost" || mobile ? (
          view.fast || view.ultrafast ? (
            <>
              <UsageShareBar
                label={t("By speed")}
                format={usd}
                segments={[
                  {
                    label: t("Standard"),
                    value: Math.max(0, view.cost - view.fast - view.ultrafast),
                    color: "var(--color-agent-blue)",
                  },
                  {
                    label: t("Fast"),
                    value: view.fast,
                    color: "var(--color-agent-violet)",
                  },
                  {
                    label: t("Ultrafast"),
                    value: view.ultrafast,
                    color: "var(--color-agent-pink)",
                  },
                ]}
              />
              <p className="usage-muted">
                {t("Premium")}: {usd(view.premium)}
              </p>
            </>
          ) : null
        ) : null}
      </section>
      <section className="usage-section">
        <header className="usage-breakdown-heading">
          <h2>{t(mobile ? "By model" : "Breakdown")}</h2>
          {!mobile ? (
            <Tabs
              value={breakdown}
              onValueChange={(value) =>
                void setBreakdown(value as typeof breakdown)
              }
            >
              <TabsList>
                <TabsTrigger value="model">{t("Model")}</TabsTrigger>
                <TabsTrigger value="time">
                  {t(input.sinceTime ? "Hour" : "Day")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </header>
        {!models.length ? (
          <Empty>
            <EmptyTitle>{t("No usage in this date range")}</EmptyTitle>
            <EmptyDescription>
              {t("Check Sources for missing logins or unreadable history.")}
            </EmptyDescription>
          </Empty>
        ) : mobile ? (
          <div className="usage-mobile-models">
            {models.length > 80 ? (
              <VirtualRows
                items={models}
                getKey={(row) => row.id}
                estimateSize={72}
              >
                {modelList}
              </VirtualRows>
            ) : (
              <ListMotion>
                {models.map((row) => (
                  <ListMotionItem key={row.id}>{modelList(row)}</ListMotionItem>
                ))}
              </ListMotion>
            )}
          </div>
        ) : breakdown === "time" ? (
          <UsageTimeTable buckets={buckets} metric={metric} format={format} />
        ) : (
          <DataTable
            data={models}
            columns={columns}
            getRowId={(row) => row.id}
            label={t("Usage by model")}
            animateRows
            containerClassName="usage-model-table"
            className="tabular-nums"
            rowClassName="active:opacity-70 cursor-pointer"
            rowProps={(row) => ({
              tabIndex: 0,
              onClick: () => onModel?.(row.original),
              onKeyDown: (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onModel?.(row.original);
                }
              },
            })}
          />
        )}
      </section>
    </>
  );
}
type TimeRow = { day: string; totals: Partial<Record<UsageProvider, number>> };
const timeColumn = createColumnHelper<typeof dataTableFeatures, TimeRow>();
function UsageTimeTable({
  buckets,
  metric,
  format,
}: {
  buckets: UsageBucket[];
  metric: "cost" | "tokens";
  format: (value: number) => string;
}) {
  const { t, language } = useTranslation();
  const map = new Map<string, TimeRow>();
  for (const bucket of buckets) {
    const day = bucket.hourStart ?? bucket.day,
      row = map.get(day) ?? { day, totals: {} };
    row.totals[bucket.provider] =
      (row.totals[bucket.provider] ?? 0) +
      (metric === "cost" ? bucket.costUsd : totalTokens(bucket.totals));
    map.set(day, row);
  }
  const providers = USAGE_PROVIDERS.filter((id) =>
    buckets.some((bucket) => bucket.provider === id),
  );
  const columns = [
    timeColumn.accessor("day", {
      header: t("Date"),
      cell: (cell) =>
        new Date(cell.getValue()).toLocaleString(
          language,
          buckets.some((bucket) => bucket.hourStart)
            ? { month: "short", day: "numeric", hour: "numeric" }
            : { month: "short", day: "numeric", timeZone: "UTC" },
        ),
    }),
    ...providers.map((id) =>
      timeColumn.accessor((row) => row.totals[id] ?? 0, {
        id,
        header: HARNESS_TITLE[id],
        cell: (cell) => format(cell.getValue()),
      }),
    ),
  ];
  return (
    <DataTable
      data={[...map.values()].sort((a, b) => b.day.localeCompare(a.day))}
      columns={columns}
      getRowId={(row) => row.day}
      label={t("Usage over time")}
      containerClassName="usage-model-table"
    />
  );
}
