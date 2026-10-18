import { motion } from "motion/react";
import { immediateTransition, panelTransition } from "../../shared/motion/tokens";
import { useMotionPreference } from "../../shared/motion/useMotionPreference";
import { useListReorderMotion } from "../../shared/hooks/useListReorderMotion";
import { usePreferenceState } from "../../features/settings/model/usePreferenceState";
import {
  memo,
  useId,
  useRef,
  startTransition,
  useOptimistic,
  type CSSProperties,
} from "react";
import {
  loadSidebarTabOrder,
  saveSidebarTabOrder,
  type SidebarTabId,
} from "../../features/settings/model/appearance";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const [selectedTab, selectTab] = useOptimistic(tab);
  const [tabOrder, setTabOrder] = usePreferenceState(loadSidebarTabOrder);
  const visibleTabs = tabs ? tabOrder.filter((id) => tabs.includes(id)) : tabOrder;
  const sortable = useAnimatedReorder(visibleTabs, (next) => {
    const order = mergeOrderedSubset(tabOrder.map((id) => ({ id })), next.map((id) => ({ id }))).map(({ id }) => id);
    setTabOrder(order);
    saveSidebarTabOrder(order);
  });

  useListReorderMotion(tabsRef, visibleTabs, "data-sidebar-tab-reorder", !sortable.draggingId);
  return (
    <div
      ref={tabsRef}
      role="tablist"
      aria-label={t("Workspace")}
      data-reordering={sortable.draggingId ? "" : undefined}
      data-resizing={resizing ? "" : undefined}
      style={{
        "--sidebar-active-tab": visibleTabs.indexOf(selectedTab),
        "--sidebar-tab-count": visibleTabs.length,
      } as CSSProperties}
      className="sidebar-segment mx-2 mb-1 flex h-7 shrink-0 items-center gap-px rounded-full bg-surface p-0.5"
    >
      {visibleTabs.map((id) => (
        <motion.div
          key={id}
          data-sidebar-tab-reorder={id}
          layout={sortable.draggingId === id}
          transition={reduced || resizing ? immediateTransition : panelTransition}
          ref={(el) => sortable.setItemRef(id, el)}
          className="reorder-item workspace-tab relative flex min-w-0 flex-1 touch-none items-stretch"
          onPointerDown={(event) => {
            if (event.button === 0) sortable.onItemPointerDown(id, event);
          }}
        >
          <button
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
              if (sortable.consumeClick()) return;
              startTransition(() => {
                selectTab(id);
                // Start the panel update with the selection while the indicator moves.
                onTabChange(id);
              });
            }}
            className="surface-tab relative isolate flex h-6 min-w-0 flex-1 items-center justify-center self-center px-2 text-ui-sm leading-none"
          >
            {selectedTab === id && !sortable.draggingId ? <motion.span layoutId={indicatorId} transition={reduced || resizing ? immediateTransition : panelTransition} aria-hidden="true" data-sidebar-tab-indicator className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-background-base" /> : null}
            {id === "changes" && (additions || deletions) ? (
              <DiffStat additions={additions} deletions={deletions} />
            ) : (
              <span className="block truncate leading-label">
                {id === "files" && filesLabel ? filesLabel : t(TAB_LABELS[id])}
              </span>
            )}
          </button>
        </motion.div>
      ))}
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
        <span className="text-emerald-400">+{formatInteger(additions)}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-400">-{formatInteger(deletions)}</span>
      ) : null}
    </span>
  );
}
