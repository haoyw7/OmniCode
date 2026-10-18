import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  type UpdaterSnapshot,
} from "../model/updater";
import {
  loadUpdatePreferences,
  saveUpdatePreferences,
} from "../model/updatePreferences";

const RECHECK_MS = 30 * 60_000;
const RETRY_MS = 60_000;
const RETURN_MIN_MS = 5 * 60_000;

export function isUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return snapshot.phase === "available" || snapshot.phase === "downloading";
}

/** The workspace owns one updater across all activity-bar layouts and pop-outs. */
export function useUpdateStatus() {
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  const installing = useRef(false);
  const install = useCallback(async () => {
    if (installing.current) return;
    installing.current = true;
    setSnapshot((current) => ({ ...current, phase: "downloading" }));
    try {
      await installPendingUpdate(setSnapshot);
    } finally {
      installing.current = false;
    }
  }, []);
  const skipVersion = useCallback(() => {
    if (snapshot.phase !== "available" || !snapshot.availableVersion) return;
    saveUpdatePreferences({ skippedVersion: snapshot.availableVersion });
    setSnapshot({ phase: "idle", currentVersion: snapshot.currentVersion });
  }, [snapshot.phase, snapshot.availableVersion, snapshot.currentVersion]);

  // The automatic probe runs on mount whether or not it ends up rendering
  // anything, so a newly published version still surfaces on its own. The
  // window usually lives on in the tray, so it probes again periodically and
  // when brought back, and retries sooner after a failed (e.g. offline) check.
  // The snapshot lives here so update state survives opening and closing its pop-out.
  const phase = useRef(snapshot.phase);
  phase.current = snapshot.phase;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let lastProbe = 0;
    let first = true;

    const probe = async () => {
      if (running || installing.current || phase.current === "downloading") return;
      running = true;
      lastProbe = Date.now();
      clearTimeout(timer);
      let delay = RECHECK_MS;
      try {
        const currentVersion = await readAppVersion();
        if (cancelled) return;
        if (first) setSnapshot({ phase: "checking", currentVersion });
        const update = await probeForUpdate();
        if (cancelled || installing.current) return;
        if (update) {
          setSnapshot({
            phase: "available",
            currentVersion,
            availableVersion: update.version,
            releaseNotes: update.body,
            releaseDate: update.date,
          });
          // Installing exits the app on Windows; only do it unattended at launch.
          if (first && loadUpdatePreferences().autoInstall) await install();
          return;
        }
        setSnapshot({ phase: "current", currentVersion });
      } catch {
        if (cancelled) return;
        delay = RETRY_MS;
        if (first) setSnapshot((current) => ({ ...current, phase: "idle" }));
      } finally {
        running = false;
        first = false;
        if (!cancelled) timer = setTimeout(() => void probe(), delay);
      }
    };
    const onReturn = () => {
      if (document.visibilityState === "visible" && Date.now() - lastProbe > RETURN_MIN_MS)
        void probe();
    };

    void probe();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [install]);

  // Activity bars memoize on this object; a fresh one each render rebuilt the
  // whole sidebar on every workspace update.
  return useMemo(
    () => ({
      snapshot,
      setSnapshot,
      actionable: isUpdateActionable(snapshot),
      install,
      skipVersion,
    }),
    [snapshot, install, skipVersion],
  );
}

export type UpdateStatus = ReturnType<typeof useUpdateStatus>;
