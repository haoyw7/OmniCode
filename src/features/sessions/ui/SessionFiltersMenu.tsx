import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Check } from "../../../shared/ui/icons";
import { type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { MenuHover } from "../../../shared/ui/MenuHover";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  hasActiveSessionFilters,
  type SessionSidebarFilters,
  type SessionTimeFilter,
} from "../model/sessionFilters";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

const MENU_WIDTH = 228;

type Props = {
  anchor: HTMLElement;
  harnesses: HarnessId[];
  filters: SessionSidebarFilters;
  onChange: (filters: SessionSidebarFilters) => void;
  onClose: () => void;
};

const TIME_OPTIONS: { id: SessionTimeFilter; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

export function SessionFiltersMenu({
  anchor,
  harnesses,
  filters,
  onChange,
  onClose,
}: Props) {
  const { t: uiT } = useTranslation();
  const hiddenHarnesses = new Set(filters.hiddenHarnesses);

  const toggleHarness = (harness: HarnessId) => {
    const next = new Set(hiddenHarnesses);
    if (next.has(harness)) next.delete(harness);
    else next.add(harness);
    onChange({ ...filters, hiddenHarnesses: [...next] });
  };

  const setTime = (time: SessionTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof SessionSidebarFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  const toggleArchived = () => {
    onChange({ ...filters, showArchived: !filters.showArchived });
    onClose();
  };

  return (
    <Popover
      anchor={anchor}
      align="end"
      gap={2}
      width={MENU_WIDTH}
      maxHeight={480}
      onDismiss={onClose}
      role="menu"
      data-menu-density="compact"
      aria-label={uiT("Filter sessions")}
      onContextMenu={(event) => event.preventDefault()}
      className="overflow-y-auto overscroll-none p-1"
    >
      <FilterItem
        label={uiT("Archived")}
        checked={filters.showArchived}
        onClick={toggleArchived}
      />

      <SectionLabel>{uiT("Status")}</SectionLabel>
      <FilterItem
        label={uiT("Working")}
        checked={filters.status.working}
        onClick={() => toggleStatus("working")}
      />
      <FilterItem
        label={uiT("Needs approval")}
        checked={filters.status.needsApproval}
        onClick={() => toggleStatus("needsApproval")}
      />
      <FilterItem
        label={uiT("Done")}
        checked={filters.status.done}
        onClick={() => toggleStatus("done")}
      />

      <SectionLabel>{uiT("Time")}</SectionLabel>
      {TIME_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={uiT(option.label)}
          checked={filters.time === option.id}
          onClick={() => setTime(option.id)}
        />
      ))}

      {harnesses.length > 0 ? (
        <>
          <SectionLabel>{uiT("Provider")}</SectionLabel>
          {harnesses.map((harness) => (
            <FilterItem
              key={harness}
              label={HARNESS_TITLE[harness]}
              checked={!hiddenHarnesses.has(harness)}
              icon={
                <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
              }
              onClick={() => toggleHarness(harness)}
            />
          ))}
        </>
      ) : null}

      {hasActiveSessionFilters(filters) ? (
        <>
          <div role="separator" className="my-1 h-px bg-content/10" />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(DEFAULT_SESSION_SIDEBAR_FILTERS)}
            className="flex h-7 w-full items-center rounded-lg px-2 text-left text-[13px] leading-none text-content/70 hover:bg-content/3 hover:text-content"
          >
            <MenuHover />
            {uiT("Clear filters")}
          </button>
        </>
      ) : null}
    </Popover>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
      {children}
    </div>
  );
}

function FilterItem({
  label,
  checked,
  icon,
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none text-content hover:bg-content/3"
    >
      <MenuHover />
      {icon}
      <span data-menu-title className="min-w-0 flex-1 truncate leading-label">{label}</span>
      {checked ? (
        <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
      ) : null}
    </button>
  );
}
