import { motion } from "motion/react";
import { immediateTransition, panelTransition } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";
import { SortableItem, SortableList } from "../../shared/ui/primitives/Sortable";
import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import {
  memo,
  useId,
  startTransition,
  useOptimistic,
  type CSSProperties,
} from "react";
import {
  loadSidebarTabOrder,
  saveSidebarTabOrder,
  type SidebarTabId,
} from "../../features/settings/model/appearance";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { formatInteger } from "../../shared/lib/numbers";
import { mergeOrderedSubset } from "../../shared/lib/reorder";

const TAB_LABELS: Record<SidebarTabId, string> = {
  sessions: "Sessions",
  files: "Explorer",
  changes: "Changes",
};

type Props = {
  tab: SidebarTabId;
  onTabChange: (tab: SidebarTabId) => void;
  additions?: number;
  deletions?: number;
  filesLabel?: string;
  resizing?: boolean;
  tabs?: readonly SidebarTabId[];
};

export const SidebarTabs = memo(function SidebarTabs({
  tab,
  onTabChange,
  additions = 0,
  deletions = 0,
  filesLabel,
  resizing = false,
  tabs,
}: Props) {
  const { t } = useTranslation();
  const reduced = useMotionPreference();
  const indicatorId = useId();
  const [selectedTab, selectTab] = useOptimistic(tab);
  const [tabOrder, setTabOrder] = usePreferenceState(loadSidebarTabOrder);
  const visibleTabs = tabs ? tabOrder.filter((id) => tabs.includes(id)) : tabOrder;
  const reorder = (next: SidebarTabId[]) => {
    const order = mergeOrderedSubset(tabOrder.map((id) => ({ id })), next.map((id) => ({ id }))).map(({ id }) => id);
    setTabOrder(order);
    saveSidebarTabOrder(order);
  };
  return (
    <div
      role="tablist"
      aria-label={t("Workspace")}
      data-resizing={resizing ? "" : undefined}
      style={{
        "--sidebar-active-tab": visibleTabs.indexOf(selectedTab),
        "--sidebar-tab-count": visibleTabs.length,
      } as CSSProperties}
      className="sidebar-segment mx-2 mb-1 flex h-7 shrink-0 items-center gap-px rounded-full bg-surface p-0.5"
    >
      <SortableList ids={visibleTabs} axis="x" onReorder={reorder} disabled={resizing} renderOverlay={(id) => t(TAB_LABELS[id])}>
      {visibleTabs.map((id) => <SortableItem id={id} key={id}>{(item) => (
        <motion.div
          {...item.motionProps}
          data-sidebar-tab-reorder={id}
          layout={!resizing && !item.sorting && !reduced ? "position" : false}
          transition={reduced || resizing ? immediateTransition : panelTransition}
          ref={item.ref}
          style={item.style}
          className="workspace-tab relative flex min-w-0 flex-1 touch-none items-stretch"
        >
          <button
            {...item.handleProps}
            type="button"
            role="tab"
            title={t(TAB_LABELS[id])}
            aria-selected={selectedTab === id}
            aria-label={
              id === "changes" && (additions || deletions)
                ? `${t("Changes")} ${additions ? `+${additions}` : ""} ${deletions ? `-${deletions}` : ""}`.trim()
                : undefined
            }
            onClick={() => {
              if (item.consumeClick()) return;
              startTransition(() => {
                selectTab(id);
                // Start the panel update with the selection while the indicator moves.
                onTabChange(id);
              });
            }}
            className="hover:opacity-80 active:opacity-70 surface-tab relative isolate flex h-6 min-w-0 flex-1 items-center justify-center self-center px-2 text-ui-sm leading-none"
          >
            {selectedTab === id && !item.sorting ? <motion.span layoutId={indicatorId} transition={reduced || resizing ? immediateTransition : panelTransition} aria-hidden="true" data-sidebar-tab-indicator className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-background-base" /> : null}
            {id === "changes" && (additions || deletions) ? (
              <DiffStat additions={additions} deletions={deletions} />
            ) : (
              <span className="block truncate leading-label">
                {id === "files" && filesLabel ? filesLabel : t(TAB_LABELS[id])}
              </span>
            )}
          </button>
        </motion.div>
      )}</SortableItem>)}
      </SortableList>
    </div>
  );
});

function DiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const { t } = useTranslation();
  const label = [
    additions > 0 ? `+${formatInteger(additions)}` : "",
    deletions > 0 ? `-${formatInteger(deletions)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      title={t("{value0} uncommitted", { value0: label })}
      className="flex shrink-0 items-center gap-1.5 font-sans text-[11px] font-semibold tabular-nums"
    >
      {additions > 0 ? (
        <span className="text-success">+{formatInteger(additions)}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-danger">-{formatInteger(deletions)}</span>
      ) : null}
    </span>
  );
}
