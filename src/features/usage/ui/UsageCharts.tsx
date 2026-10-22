import { useState } from "react";
import type {
  UsageBucket,
  UsageProvider,
} from "../../../integrations/harness/core/usage";
import {
  USAGE_PROVIDERS,
  totalTokens,
} from "../../../integrations/harness/core/usage";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { useTranslation } from "../../../shared/i18n/useTranslation";

const colors = {
  claude: "orange",
  codex: "green",
  grok: "blue",
  cursor: "violet",
  pi: "pink",
  omp: "amber",
  opencode: "teal",
  antigravity: "indigo",
};
export const usageColor = (provider: UsageProvider) =>
  `var(--color-agent-${colors[provider]})`;
export function UsageChart({
  buckets,
  metric,
  mobile,
  from,
  to,
  format,
}: {
  buckets: readonly UsageBucket[];
  metric: "cost" | "tokens";
  mobile: boolean;
  from: string;
  to: string;
  format: (value: number) => string;
}) {
  const { t, language } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const hourly =
      from.includes("T") || buckets.some((bucket) => bucket.hourStart),
    interval = hourly ? 3600_000 : 86400_000;
  const start = hourly
    ? Math.floor(Date.parse(from) / interval) * interval
    : Date.parse(from);
  const end = hourly ? Date.parse(to) : Date.parse(to);
  const length = Math.max(
    1,
    Math.min(hourly ? 25 : 367, Math.floor((end - start) / interval) + 1),
  );
  const dates = Array.from({ length }, (_, index) =>
    new Date(start + index * interval).toISOString(),
  );
  const values = dates.map(
    () =>
      Object.fromEntries(USAGE_PROVIDERS.map((id) => [id, 0])) as Record<
        UsageProvider,
        number
      >,
  );
  for (const bucket of buckets) {
    const index = Math.floor(
      (Date.parse(bucket.hourStart ?? bucket.day) - start) / interval,
    );
    if (values[index])
      values[index][bucket.provider] +=
        metric === "cost" ? bucket.costUsd : totalTokens(bucket.totals);
  }
  const totals = values.map((value) =>
    USAGE_PROVIDERS.reduce((sum, id) => sum + value[id], 0),
  );
  const maximum = Math.max(...totals, 1),
    width = 720,
    height = mobile ? 180 : 260,
    top = 16,
    bottom = height - 24;
  const present = USAGE_PROVIDERS.filter((id) =>
    values.some((value) => value[id] > 0),
  );
  const step = width / Math.max(values.length, 1),
    y = (value: number) => bottom - (value / maximum) * (bottom - top);
  const timestamp = (index: number) =>
    new Date(dates[index]).toLocaleString(
      language,
      hourly
        ? { hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    );
  return (
    <figure className="usage-chart" data-mobile={mobile || undefined}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t(
          metric === "cost"
            ? "Cost by provider over time"
            : "Tokens by provider over time",
        )}
        onPointerMove={
          mobile
            ? undefined
            : (event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setHover(
                  Math.min(
                    values.length - 1,
                    Math.max(
                      0,
                      Math.floor(
                        ((event.clientX - rect.left) / rect.width) *
                          values.length,
                      ),
                    ),
                  ),
                );
              }
        }
        onPointerLeave={() => setHover(null)}
      >
        <title>{`${from} – ${to}: ${format(totals.reduce((sum, value) => sum + value, 0))}`}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={y(maximum * fraction)}
            y2={y(maximum * fraction)}
            stroke="currentColor"
            opacity="0.1"
          />
        ))}
        {present.map((id, providerIndex) => {
          const lower = values.map((value) =>
            present
              .slice(0, providerIndex)
              .reduce((sum, key) => sum + value[key], 0),
          );
          const upper = values.map((value, index) => lower[index] + value[id]);
          if (mobile || values.length === 1)
            return (
              <g key={id} fill={usageColor(id)}>
                {values.map((value, index) => (
                  <rect
                    key={index}
                    x={index * step + step * 0.15}
                    y={y(upper[index])}
                    width={step * 0.7}
                    height={(value[id] / maximum) * (bottom - top)}
                  >
                    <title>
                      {timestamp(index)} · {HARNESS_TITLE[id]}:{" "}
                      {format(value[id])}
                    </title>
                  </rect>
                ))}
              </g>
            );
          const x = (index: number) =>
            values.length === 1
              ? width / 2
              : (index / (values.length - 1)) * width;
          const points = [
            ...upper.map((value, index) => `${x(index)},${y(value)}`),
            ...lower.map(
              (_, index) =>
                `${x(lower.length - 1 - index)},${y(lower[lower.length - 1 - index])}`,
            ),
          ].join(" ");
          return (
            <polygon
              key={id}
              points={points}
              fill={usageColor(id)}
              opacity="0.8"
            />
          );
        })}
        {hover !== null ? (
          <line
            x1={(hover + 0.5) * step}
            x2={(hover + 0.5) * step}
            y1={top}
            y2={bottom}
            stroke="currentColor"
            opacity="0.5"
          />
        ) : null}
      </svg>
      <figcaption>
        <span>{timestamp(0)}</span>
        <span>{format(maximum)}</span>
        <span>{timestamp(values.length - 1)}</span>
      </figcaption>
      {hover !== null ? (
        <div className="usage-chart-tooltip" role="status">
          <strong>{timestamp(hover)}</strong>
          {present.map((id) => (
            <span key={id}>
              <i style={{ background: usageColor(id) }} />
              {HARNESS_TITLE[id]} <b>{format(values[hover][id])}</b>
            </span>
          ))}
        </div>
      ) : null}
      {mobile ? (
        <div className="usage-chart-legend">
          {present.map((id) => (
            <span key={id}>
              <i style={{ background: usageColor(id) }} />
              {HARNESS_TITLE[id]}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
export function UsageShareBar({
  segments,
  label,
  format,
}: {
  segments: { label: string; value: number; color: string }[];
  label: string;
  format: (value: number) => string;
}) {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0,
  );
  return (
    <div className="usage-share">
      <div
        className="usage-share-bar"
        role="img"
        aria-label={`${label}: ${segments.map((segment) => `${segment.label} ${format(segment.value)}`).join(", ")}`}
      >
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.label}
              style={{
                width: `${(segment.value / total) * 100}%`,
                background: segment.color,
              }}
              title={`${segment.label}: ${format(segment.value)}`}
            />
          ))}
      </div>
      <div className="usage-share-legend">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span key={segment.label}>
              <i style={{ background: segment.color }} />
              {segment.label}
              <b>{format(segment.value)}</b>
            </span>
          ))}
      </div>
    </div>
  );
}
