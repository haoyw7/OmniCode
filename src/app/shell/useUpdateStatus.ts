import { useCallback, useEffect, useMemo, useRef, type SetStateAction } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/lib/queryClient";
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
  const queryKey = ["app", "updateStatus"] as const;
  const setSnapshot = useCallback((value: SetStateAction<UpdaterSnapshot>) => {
    queryClient.setQueryData<UpdaterSnapshot>(["app", "updateStatus"], current =>
      typeof value === "function" ? value(current ?? { phase: "idle", currentVersion: "…" }) : value);
  }, []);
  const installing = useRef(false);
  const installation = useMutation({ mutationFn: () => installPendingUpdate(setSnapshot) }, queryClient);
  const install = useCallback(async () => {
    if (installing.current) return;
    installing.current = true;
    await queryClient.cancelQueries({ queryKey: ["app", "updateStatus"], exact: true });
    setSnapshot(current => ({ ...current, phase: "downloading" }));
    try { await installation.mutateAsync(); } finally { installing.current = false; }
  }, [installation.mutateAsync, setSnapshot]);
  const read = useQuery({
    queryKey, enabled: !installation.isPending, staleTime: RETURN_MIN_MS,
    refetchInterval: query => query.state.status === "error" ? RETRY_MS : RECHECK_MS,
    refetchIntervalInBackground: true,
    queryFn: async (): Promise<UpdaterSnapshot> => {
      const currentVersion = await queryClient.fetchQuery({ queryKey: ["app", "version"], queryFn: readAppVersion, staleTime: Infinity });
      const update = await probeForUpdate();
      return update ? { phase: "available", currentVersion, availableVersion: update.version, releaseNotes: update.body, releaseDate: update.date } : { phase: "current", currentVersion };
    },
  }, queryClient);
  const snapshot: UpdaterSnapshot = read.data ?? { phase: read.isFetching ? "checking" : "idle", currentVersion: "…" };
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || !read.isFetched) return;
    first.current = false;
    if (read.isSuccess && read.data.phase === "available" && loadUpdatePreferences().autoInstall) void install();
  }, [read.isFetched, read.isSuccess, read.data, install]);
  const skipVersion = useCallback(() => {
    if (snapshot.phase !== "available" || !snapshot.availableVersion) return;
    saveUpdatePreferences({ skippedVersion: snapshot.availableVersion });
    setSnapshot({ phase: "idle", currentVersion: snapshot.currentVersion });
  }, [snapshot.phase, snapshot.availableVersion, snapshot.currentVersion, setSnapshot]);

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
