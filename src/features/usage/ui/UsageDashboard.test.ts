// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NuqsAdapter } from "nuqs/adapters/react";
import { UsageDashboard } from "./UsageDashboard";
import {
  EMPTY_TOTALS,
  type UsageSummary,
} from "../../../integrations/harness/core/usage";
import { queryClient } from "../../../shared/lib/queryClient";
import { setUiLanguage } from "../../../shared/i18n/language";
import { useUsagePreferences } from "../model/usagePreferences";
import type { UsageTransport } from "../model/usageTransport";

let root: Root, node: HTMLDivElement;
const summary = (model: string): UsageSummary => ({
  contractVersion: 1,
  readAt: Date.now(),
  sinceDay: "2026-10-01",
  untilDay: "2026-10-31",
  timeZone: "UTC",
  sessions: 1,
  pricing: {
    status: "cached",
    fetchedAt: Date.now(),
    source: "https://example.test/prices",
    knownModels: 1,
  },
  priceOverrides: {},
  sources: [],
  cursorKeychainEnabled: false,
  scanDurationMs: 2,
  buckets: [
    {
      day: "2026-10-20",
      provider: "claude",
      model,
      totals: { ...EMPTY_TOTALS, uncachedInputTokens: 100, outputTokens: 20 },
      costUsd: 2.5,
      cacheSavingsUsd: 1,
      categoryCostUsd: { input: 2, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      otherCostUsd: 0,
      fastCostUsd: 0,
      ultrafastCostUsd: 0,
      speedPremiumUsd: 0,
      records: 1,
      unpricedRecords: 0,
    },
  ],
});
const transport = (
  sourceKey: string,
  result = summary(sourceKey),
): UsageTransport => ({
  sourceKey,
  label: sourceKey,
  enabled: true,
  summary: vi.fn(async () => result),
  limits: vi.fn(async () => [
    {
      id: "claude:work",
      provider: "claude",
      label: "Personal label",
      status: "ok",
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 42 }],
    },
  ]),
  update: vi.fn(async () => ({})),
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/");
  setUiLanguage("en");
  useUsagePreferences.setState({ metric: "limits", days: 30, hidden: [] });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});
const render = async (host: UsageTransport, mobile = false) =>
  act(async () =>
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(UsageDashboard, {
          environments: [host],
          mobile,
          icon: (provider) =>
            createElement("span", { "data-provider": provider }),
          select: (props) =>
            createElement(
              "select",
              {
                "aria-label": props.label,
                value: props.value,
                disabled: props.disabled,
                onChange: (event) => props.onChange(event.target.value),
              },
              props.options.map((item) =>
                createElement(
                  "option",
                  { key: item.value, value: item.value },
                  item.label,
                ),
              ),
            ),
          dialog: (props) =>
            props
              ? createElement(
                  "div",
                  { role: "dialog", "aria-label": props.title },
                  props.children,
                )
              : null,
        }),
      ),
    ),
  );
async function tab(label: string) {
  const button = [
    ...node.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((button) => button.textContent === label)!;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    button.click();
  });
}
it("defaults to Limits, then loads the unified model bill separately", async () => {
  const host = transport("host-a");
  await render(host);
  await vi.waitFor(() => expect(node.textContent).toContain("58%"));
  expect(host.summary).not.toHaveBeenCalled();
  expect(
    node.querySelector<HTMLSelectElement>('[aria-label="Date range"]')!
      .disabled,
  ).toBe(true);
  await tab("Cost");
  await vi.waitFor(() =>
    expect(node.querySelector("table")?.textContent).toContain("host-a"),
  );
  expect(node.textContent).toContain("$2.50");
  expect(node.textContent).toContain("API estimate");
  expect(node.querySelector('[data-provider="claude"]')).not.toBeNull();
  await act(async () =>
    node.querySelector<HTMLTableRowElement>("tbody tr")!.click(),
  );
  const detail = node.querySelector('[role="dialog"]');
  expect(detail?.textContent).toContain("Effective USD per million tokens");
  expect(detail?.textContent).toContain("Cache savings");
  expect(detail?.textContent).not.toContain("Set price");
  expect(detail?.querySelector("form")).toBeNull();
});
it("isolates pending summaries when switching Hosts", async () => {
  useUsagePreferences.setState({ metric: "cost" });
  let finish!: (value: UsageSummary) => void;
  const first = transport("host-a");
  first.summary = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(first);
  await vi.waitFor(() => expect(first.summary).toHaveBeenCalled());
  await render(transport("host-b"));
  await vi.waitFor(() =>
    expect(node.querySelector("table")?.textContent).toContain("host-b"),
  );
  await act(async () => finish(summary("host-a")));
  expect(node.querySelector("table")?.textContent).not.toContain("host-a");
});
it("reports an unsupported Host and keeps retry available", async () => {
  const host = transport("old-host");
  host.limits = vi.fn(async () => {
    throw new Error(
      "This Host does not support usage yet. Update and restart it, then refresh.",
    );
  });
  await render(host);
  await vi.waitFor(() =>
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "does not support usage",
    ),
  );
  expect(
    [...node.querySelectorAll("button")].some(
      (button) => button.textContent === "Retry" && !button.disabled,
    ),
  ).toBe(true);
});
it("uses the phone layout without desktop model dialogs or price editing", async () => {
  const host = transport("phone");
  await render(host, true);
  await tab("Usage");
  await vi.waitFor(() => expect(node.textContent).toContain("By model"));
  expect(node.querySelector("table")).toBeNull();
  expect(node.querySelector(".usage-total-grid")?.children).toHaveLength(6);
  expect(node.textContent).toContain("* if billed at full API rate");
  expect(node.textContent).not.toContain("Model prices");
  expect(node.querySelector('.usage-chart[data-mobile="true"]')).not.toBeNull();
});
it("keeps the last summary visible and dims it while refreshing", async () => {
  useUsagePreferences.setState({ metric: "cost" });
  const host = transport("host-a");
  await render(host);
  await vi.waitFor(() => expect(node.textContent).toContain("$2.50"));
  let finish!: (value: UsageSummary) => void;
  host.summary = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')!
      .click(),
  );
  await vi.waitFor(() =>
    expect(
      node.querySelector(".usage-dashboard")?.getAttribute("aria-busy"),
    ).toBe("true"),
  );
  expect(node.textContent).toContain("$2.50");
  await act(async () => finish(summary("refreshed")));
  await vi.waitFor(() =>
    expect(node.querySelector("table")?.textContent).toContain("refreshed"),
  );
});
