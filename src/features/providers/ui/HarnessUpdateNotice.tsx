import { Button } from "../../../shared/ui/forms/Button";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useLayoutEffect, useRef } from "react";
import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { createPortal } from "react-dom";
import { GlassBackdrop } from "../../../shared/ui/GlassBackdrop";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { LAYER } from "../../../shared/lib/layers";
import { Check, X } from "../../../shared/ui/icons";
import { isPickerProviderVisible } from "../../sessions/model/models";
import {
  HARNESS_TITLE,
  HARNESSES,
  type HarnessId,
} from "../../sessions/model/session";
import { HarnessIcon } from "../../../shared/ui/branding/HarnessIcon";
import {
  claimLaunchHarnessUpdateCheck,
  fetchHarnessInstall,
  fetchLatestHarnessVersion,
  findHarnessUpdates,
  UPDATABLE_HARNESSES,
  type HarnessUpdate,
} from "../model/harnessUpdates";
import { useHarnessRefreshSync } from "../model/harnessRefreshSync";
import { runHarnessUpdate, type HarnessUpdateState } from "../model/harnessUpdateAction";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

/**
 * Shared by every mount in this window: a StrictMode remount must reuse the
 * first run, since the launch claim it made cannot be taken twice.
 */
let launchCheck: Promise<HarnessUpdate[]> | null = null;

function checkForHarnessUpdates(): Promise<HarnessUpdate[]> {
  launchCheck ??= runLaunchCheck().catch(() => []);
  return launchCheck;
}

async function runLaunchCheck(): Promise<HarnessUpdate[]> {
  if (!(await claimLaunchHarnessUpdateCheck())) return [];
  await probeHarnessAvailability();
  const updates = await findHarnessUpdates({
    harnesses: HARNESSES.filter(
      (id) =>
        UPDATABLE_HARNESSES.has(id) &&
        isHarnessAvailable(id) &&
        isPickerProviderVisible(id),
    ),
    installedVersion: async (id) => (await inspectHarnessBinary(id)).version,
    latestVersion: fetchLatestHarnessVersion,
  });
  // A copy bundled inside another app only updates with that app, so its
  // Update button could never succeed; Settings explains it instead.
  const updatable = await Promise.all(
    updates.map((update) =>
      fetchHarnessInstall(update.harness)
        .then((install) => install?.source !== "bundled")
        .catch(() => true),
    ),
  );
  return updates.filter((_, index) => updatable[index]);
}

const NO_UPDATES: HarnessUpdate[] = [];

/** Checked once per app launch, in whichever window asks first. */
export function HarnessUpdateNotice({
  topOffset = 12,
  onHeightChange,
}: {
  topOffset?: number;
  onHeightChange?: (height: number) => void;
}) {
  const { t: uiT } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const updating = useMutation({ mutationKey: ["harnessUpdate"], mutationFn: (update: HarnessUpdate) => runHarnessUpdate(update), gcTime: Infinity }, queryClient);
  const rows = Object.fromEntries(useMutationState({ filters: { mutationKey: ["harnessUpdate"] }, select: mutation => {
    const update = mutation.state.variables as HarnessUpdate;
    const state: HarnessUpdateState = mutation.state.status === "pending" ? { status: "updating" }
      : mutation.state.data as HarnessUpdateState ?? { status: "idle" };
    return [update.harness, state] as const;
  } }, queryClient));

  // Mounted in every workspace window, so the window that ran an update or
  // refresh tells the others to pick up the CLIs' models too.
  useHarnessRefreshSync();

  const { data: updates = NO_UPDATES } = useQuery(
    {
      queryKey: ["harness", "updates"],
      queryFn: checkForHarnessUpdates,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
    queryClient,
  );

  const visible = updates.length > 0;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onHeightChange) return;
    const measure = () => onHeightChange(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [visible, onHeightChange]);
  if (!visible) return null;

  const stateOf = (harness: HarnessId): HarnessUpdateState =>
    rows[harness] ?? { status: "idle" };
  const busy = updates.some(
    (update) => stateOf(update.harness).status === "updating",
  );
  const pending = updates.filter((update) => {
    const status = stateOf(update.harness).status;
    return status === "idle" || status === "failed";
  });
  const anyUpdated = updates.some(
    (update) => stateOf(update.harness).status === "updated",
  );

  const start = (targets: HarnessUpdate[]) => {
    for (const update of targets) updating.mutate(update);
  };
  const dismiss = () => {
    // Only for this run: the next launch checks and offers again.
    launchCheck = Promise.resolve([]);
    queryClient.setQueryData(["harness", "updates"], NO_UPDATES);
  };

  return createPortal(
    <section
      ref={panelRef}
      aria-label={uiT("Harness updates")}
      role="status"
      style={{ zIndex: LAYER.toast, top: topOffset }}
      className="fixed right-3 isolate w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-xl border border-content/10 text-content shadow-xl"
    >
      <GlassBackdrop />
      <div className="relative z-[1]">
        <div className="flex items-center gap-2 border-b border-stroke px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
            {updates.length === 1
              ? uiT("Harness update available")
              : uiT("Harness updates available")}
          </span>
          {pending.length > 1 ? (
            <Button variant="ghost" size="sm"
              type="button"
              onClick={() => start(pending)}
            >
              {uiT("Update all")}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm"
            type="button"
            aria-label={uiT("Dismiss harness updates")}
            disabled={busy}
            onClick={dismiss}
          >
            <X className="size-3" />
          </Button>
        </div>
        <div className="divide-y divide-stroke">
          {updates.map((update) => (
            <HarnessUpdateRow
              key={update.harness}
              update={update}
              state={stateOf(update.harness)}
              onUpdate={() => start([update])}
            />
          ))}
        </div>
        <p className="border-t border-stroke px-3 py-2 text-[11px] text-content/50">
          {anyUpdated
            ? uiT("Model picker refreshed with the new version’s models.")
            : uiT("New models often need the latest version.")}
        </p>
      </div>
    </section>,
    document.body,
  );
}

function HarnessUpdateRow({
  update,
  state,
  onUpdate,
}: {
  update: HarnessUpdate;
  state: HarnessUpdateState;
  onUpdate: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <article className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <HarnessIcon harness={update.harness} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {HARNESS_TITLE[update.harness]}
        </span>
        {state.status === "updated" ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-success">
            <Check className="size-3.5" />
            {uiT("Updated to ")}
            {state.version}
          </span>
        ) : (
          <>
            <span className="shrink-0 font-mono text-[11px] text-content/50">
              {update.installed} → {update.latest}
            </span>
            <Button variant="secondary" size="sm"
              type="button"
              disabled={state.status === "updating"}
              onClick={onUpdate}
            >
              {state.status === "updating" ? (
                <>
                  <Spinner className="size-3" />
                  {uiT("Updating")}
                </>
              ) : state.status === "failed" ? (
                uiT("Retry")
              ) : (
                uiT("Update")
              )}
            </Button>
          </>
        )}
      </div>
      {state.status === "failed" ? (
        <p
          role="alert"
          className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-danger/90"
          title={state.error}
        >
          {state.error}
        </p>
      ) : null}
    </article>
  );
}
