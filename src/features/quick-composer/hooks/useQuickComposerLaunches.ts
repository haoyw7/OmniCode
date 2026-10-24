import { probeHarnessAvailability } from "../../providers/model/harnessAvailability";
import { refreshHostModelCatalogs } from "../../providers/model/hostModelCatalog";
import { useEffect, useRef } from "react";
import { takeQuickComposerLaunch, acknowledgeQuickComposerLaunch, subscribeQuickComposerSignal, publishQuickComposerCatalog, type QuickComposerSignal } from "../../../platform/tauri/quickComposer";
import { loadQuickComposerEnabled, loadQuickComposerShortcut } from "../../settings/model/settings";
import { subscribeSharedPreferences } from "../../settings/model/sharedPreferences";
import { launchReceiver } from "../model/launchDelivery";
import { prepareQuickComposerWhenIdle } from "../model/prepareQuickComposer";
import { liveQuickCatalog, isHarnessId, QUICK_COMPOSER_CATALOG_REQUEST_EVENT, QUICK_COMPOSER_LAUNCH_EVENT, quickComposerSupported, setQuickComposerShortcut, type QuickLaunch } from "../model/quickComposer";

/**
 * Claims the global shortcut per the setting, answers the panel's requests for
 * model catalogs, and starts sessions handed to this window. The backend keeps
 * each launch until acceptance is acknowledged; mount, focus, and launch events
 * drain the queue through one serialized receiver.
 */
export function useQuickComposerLaunches(
  onLaunch: (launch: QuickLaunch, id: string) => Promise<void>,
) {
  const accepting = useRef(new Map<string, Promise<void>>());
  const accepted = useRef(new Set<string>());
  const onLaunchRef = useRef(onLaunch);
  onLaunchRef.current = onLaunch;

  useEffect(() => {
    if (!quickComposerSupported()) return;
    const stopPreparing = prepareQuickComposerWhenIdle();
    let shortcutConfiguration: string | undefined;
    const applyShortcut = () => {
      const enabled = loadQuickComposerEnabled(), shortcut = loadQuickComposerShortcut();
      const configuration = JSON.stringify([enabled, shortcut]);
      if (configuration === shortcutConfiguration) return;
      shortcutConfiguration = configuration;
      void setQuickComposerShortcut(enabled, shortcut).catch(() => {
        if (shortcutConfiguration === configuration) shortcutConfiguration = undefined;
      });
    };
    applyShortcut();
    const stopShortcutSync = subscribeSharedPreferences(applyShortcut);

    let disposed = false;
    const receive = launchReceiver({
      take: () => takeQuickComposerLaunch(),
      accept: (launch, id) => onLaunchRef.current(launch, id),
      ack: (id) => acknowledgeQuickComposerLaunch(id),
      disposed: () => disposed,
      accepted: accepted.current,
      accepting: accepting.current,
    });
    const take = () =>
      receive().catch((error) => {
        console.error(
          "Quick session delivery failed; session remains queued:",
          error,
        );
      });
    const onFocus = () => void take();
    const subscriptions: Array<() => void> = [];
    const subscribe = async (
      event: QuickComposerSignal,
      handler: (event: { payload: unknown }) => void,
    ) => {
      const stop = await subscribeQuickComposerSignal(event, handler);
      if (disposed) stop();
      else subscriptions.push(stop);
    };
    void Promise.all([
      subscribe(QUICK_COMPOSER_LAUNCH_EVENT, () => void take()),
      subscribe(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, (event) => {
        void probeHarnessAvailability()
          .then(async () => {
            if (disposed) return;
            void publishQuickComposerCatalog(liveQuickCatalog());
            // Only probe the provider the user opened, like the workspace picker.
            if (isHarnessId(event.payload)) {
              await refreshHostModelCatalogs([event.payload]);
              if (!disposed)
                void publishQuickComposerCatalog(liveQuickCatalog());
            }
          })
          .catch(() => undefined);
      }),
    ])
      .then(() => take())
      .catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      receive.dispose();
      stopPreparing();
      stopShortcutSync();
      for (const stop of subscriptions) stop();
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
