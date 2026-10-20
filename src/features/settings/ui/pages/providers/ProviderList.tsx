import type { KeyboardEvent } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Loader } from "../../../../../shared/ui/icons";
import { NavigationItem } from "../../../../../shared/ui/messaging/NavigationItem";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { HarnessIcon } from "../../../../sessions/ui/HarnessIcon";
import { useHarnessInstall } from "../../../../providers/model/harnessInstall";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import { PROVIDER_DETAIL_ID } from "./ProviderDetail";

export type ProviderListEntry = {
  harness: HarnessId;
  available: boolean;
  isDefault: boolean;
  updatable: boolean;
};

/**
 * Providers beside their detail: installed first, then the ones that can be
 * installed. Narrow settings panes show the same list as a menu instead.
 */
export function ProviderList({
  entries,
  selected,
  onSelect,
}: {
  entries: readonly ProviderListEntry[];
  selected: HarnessId;
  onSelect: (harness: HarnessId) => void;
}) {
  const { t: uiT } = useTranslation();
  const groups = [
    { label: uiT("Installed"), entries: entries.filter((entry) => entry.available) },
    { label: uiT("Not installed"), entries: entries.filter((entry) => !entry.available) },
  ].filter((group) => group.entries.length > 0);
  const order = groups.flatMap((group) => group.entries.map((entry) => entry.harness));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = order.indexOf(selected);
    const next =
      event.key === "ArrowDown" ? order[(index + 1) % order.length]
      : event.key === "ArrowUp" ? order[(index - 1 + order.length) % order.length]
      : event.key === "Home" ? order[0]
      : event.key === "End" ? order[order.length - 1]
      : undefined;
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-provider="${next}"]`)
      ?.focus();
  };

  return (
    <>
      <nav
        data-ui="provider-list"
        aria-label={uiT("Providers")}
        onKeyDown={onKeyDown}
      >
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <div data-ui="provider-list-heading" aria-hidden>
              {group.label}
            </div>
            {group.entries.map((entry) => (
              <NavigationItem
                key={entry.harness}
                data-provider={entry.harness}
                data-unavailable={!entry.available || undefined}
                icon={<HarnessIcon harness={entry.harness} className="size-4" />}
                aria-current={entry.harness === selected ? "true" : undefined}
                aria-controls={PROVIDER_DETAIL_ID}
                tabIndex={entry.harness === selected ? 0 : -1}
                onClick={() => onSelect(entry.harness)}
                trailing={<ProviderListBadges entry={entry} />}
              >
                {HARNESS_TITLE[entry.harness]}
              </NavigationItem>
            ))}
          </div>
        ))}
      </nav>
      <div data-ui="provider-list-compact">
        <SearchableSelect searchable={false} width={280} maxHeight={360} commitOnTab checkPosition="end"
          label={uiT("Provider")}
          value={selected}
          onChange={(next) => onSelect(next as HarnessId)}
          options={groups.flatMap((group) =>
            group.entries.map((entry) => ({
              value: entry.harness,
              label: HARNESS_TITLE[entry.harness],
              group: group.label,
              icon: <HarnessIcon harness={entry.harness} className="size-4" />,
            })),
          )}
        />
      </div>
    </>
  );
}

function ProviderListBadges({ entry }: { entry: ProviderListEntry }) {
  const { t: uiT } = useTranslation();
  const { state } = useHarnessInstall(entry.harness);
  const busy = state.status === "installing" || state.status === "uninstalling";
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {busy ? (
        <Loader className="size-3.5 animate-spin text-content/50" aria-label={uiT("Working…")} />
      ) : entry.updatable ? (
        <span
          data-ui="provider-update-dot"
          role="img"
          aria-label={uiT("Update available")}
          title={uiT("Update available")}
        />
      ) : null}
      {entry.isDefault ? (
        <span data-ui="provider-chip" data-tone="accent">
          {uiT("Default")}
        </span>
      ) : null}
    </span>
  );
}
