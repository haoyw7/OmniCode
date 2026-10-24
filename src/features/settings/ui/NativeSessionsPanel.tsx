import { Switch } from "../../../shared/ui/forms/Switch";
import { isDesktopShell } from "../../../platform/tauri/window";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { RefreshCw, Search } from "../../../shared/ui/icons";
import { dismissStatusToast, showStatusToast, updateStatusToast, withStatusToast } from "../../../shared/ui/StatusToast";
import { HarnessIcon } from "../../../shared/ui/HarnessIcon";
import { discoverNativeSessions, importNativeSession, importNativeSessions, nativeSessionSnapshot, setNativeAutoSync, subscribeNativeSessions, syncNativeSessions } from "../../sessions/data/nativeSessions";
import { NATIVE_SESSION_PROVIDERS, nativeProviderLabel, nativeSourceKey } from "../../../integrations/harness/core/nativeSessions";
import { type NativeSessionFile, type NativeSessionProvider } from "../../../contracts/session";

const PAGE = 20;

function relative(ms: number, locale: string): string {
  const minutes = Math.round((ms - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(days, "day");
  return new Date(ms).toLocaleDateString(locale);
}

function Card({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id ? `setting-${id}` : undefined}
      data-setting-id={id}
      className="pt-8 first:pt-0"
    >
      <div className="flex items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="desktop-pane-heading text-[15px] font-semibold text-content">{title}</h2>
          {description ? (
            <p className="mt-1 text-[12px] leading-relaxed text-content/45">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0 pb-0.5">{action}</div> : null}
      </div>
      <div className="desktop-card overflow-hidden rounded-xl border border-content/10 bg-content/3">
        {children}
      </div>
    </section>
  );
}

const pillClass =
  "shrink-0 rounded-lg bg-content/6 px-3 py-1.5 text-[13px] text-content hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-content/6";

/** Settings → Import: keep imported conversations synced and import new ones per app. */
export function NativeSessionsPanel({
  onOpenSession,
}: {
  onOpenSession?: (id: string) => void;
}) {
  const { t, language } = useTranslation();
  const state = useSyncExternalStore(
    subscribeNativeSessions,
    nativeSessionSnapshot,
  );
  const [open, setOpen] = useState<NativeSessionProvider>();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState<string>();
  const [imported, setImported] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number }>();
  const bulkRun = useRef<{ cancelled: boolean }>(undefined);
  const desktop = typeof isDesktopShell === "function" && isDesktopShell();
  useEffect(() => {
    if (desktop) void discoverNativeSessions().catch(() => undefined);
  }, [desktop]);
  const byProvider = useMemo(() => {
    const groups = new Map<NativeSessionProvider, NativeSessionFile[]>(
      NATIVE_SESSION_PROVIDERS.map((provider) => [provider, []]),
    );
    for (const file of state.files) groups.get(file.provider)?.push(file);
    return groups;
  }, [state.files]);
  const isBound = (file: NativeSessionFile) =>
    !!imported[nativeSourceKey(file)] ||
    state.bound.has(`${file.provider}:${file.providerSessionId}`);
  const importFile = async (file: NativeSessionFile) => {
    const key = nativeSourceKey(file);
    setPending(key);
    try {
      const id = await withStatusToast(() => importNativeSession(file), {
        loading: t("Importing conversation…"),
        success: (id) => !!id && t("Conversation imported"),
        error: false,
      });
      if (!id) return;
      setImported((current) => ({ ...current, [key]: id }));
      onOpenSession?.(id);
    } catch {
      /* The shared status carries the concrete error. */
    } finally {
      setPending(undefined);
    }
  };
  /** Import every listed conversation that is not in OmniCode yet, one at a time. */
  const importAll = async (targets: NativeSessionFile[]) => {
    const queue = targets.filter((file) => !isBound(file));
    if (!queue.length || bulk) return;
    const run = { cancelled: false };
    bulkRun.current = run;
    setBulk({ done: 0, total: queue.length });
    const added: Record<string, string> = {};
    const { done, failed } = await importNativeSessions(queue, {
      stop: run,
      onProgress: (progress) => setBulk(progress),
      onImported: (file, id) => {
        added[nativeSourceKey(file)] = id;
      },
    }).catch(() => ({ done: 0, failed: 0 }));
    setImported((current) => ({ ...current, ...added }));
    bulkRun.current = undefined;
    setBulk(undefined);
    const count = done - failed;
    const result = failed
      ? t("Imported {imported} conversations; {failed} could not be imported.", {
          imported: count,
          failed,
        })
      : t("Imported {imported} conversations.", { imported: count });
    showStatusToast(
      run.cancelled ? `${result} ${t("Stopped before finishing.")}` : result,
      failed && !count ? "error" : "success",
    );
  };
  const syncImported = async () => {
    const id = showStatusToast(t("Syncing imported conversations…"), "loading");
    await syncNativeSessions();
    // Failures stay in the panel's shared error line.
    if (nativeSessionSnapshot().error) dismissStatusToast(id);
    else updateStatusToast(id, t("Imported conversations synced"), "success");
  };
  const toggle = (provider: NativeSessionProvider) => {
    setOpen((current) => (current === provider ? undefined : provider));
    setQuery("");
    setShown(PAGE);
  };
  const importedCount = state.importedCount ?? 0;
  const notImported = state.files.filter((file) => !isBound(file)).length;
  return (
    <>
      <Card id="native-auto-sync" title={t("Auto sync")}>
        <div className="flex items-center gap-6 border-b border-content/5 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-content">
              {t("Keep imports synced")}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-content/45">
              {state.autoSync
                ? t(
                    "Imported conversations follow their app live, even while OmniCode is closed.",
                  )
                : t(
                    "Sync paused. Imported conversations keep their saved history.",
                  )}
            </p>
          </div>
          <Switch
            aria-label={t("Keep imports synced")}
            checked={state.autoSync}
            onCheckedChange={setNativeAutoSync}
          />
        </div>
        <div className="flex items-center gap-6 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-content">
              {t("Imported conversations")}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-content/45">
              {importedCount
                ? state.lastSynced
                  ? t("{count} imported · last synced {time}", {
                      count: importedCount,
                      time: relative(state.lastSynced, language),
                    })
                  : t("{count} imported", { count: importedCount })
                : t("Available after your first import")}
            </p>
          </div>
          <button
            type="button"
            className={pillClass}
            disabled={!importedCount || state.busy}
            onClick={() => void syncImported()}
          >
            {t("Sync now")}
          </button>
        </div>
      </Card>

      <Card
        id="native-sessions"
        title={t("Import from other AI apps")}
        description={t(
          "Conversations found on this computer. Importing keeps the original session, so you can continue it here or in its app.",
        )}
        action={
          <div className="flex items-center gap-1.5">
            {bulk ? (
              <button
                type="button"
                className={pillClass}
                onClick={() => {
                  if (bulkRun.current) bulkRun.current.cancelled = true;
                }}
              >
                {t("Importing {done}/{total} · Stop", bulk)}
              </button>
            ) : (
              <button
                type="button"
                className={pillClass}
                disabled={!desktop || state.busy || !notImported}
                onClick={() => void importAll(state.files)}
              >
                {t("Import all ({count})", { count: notImported })}
              </button>
            )}
            <button
              type="button"
              aria-label={t("Rescan")}
              title={t("Rescan")}
              disabled={!desktop || state.busy}
              onClick={() =>
                void discoverNativeSessions().catch(() => undefined)
              }
              className="grid size-7 place-items-center rounded-md text-content/50 hover:bg-content/5 hover:text-content disabled:opacity-40"
            >
              <RefreshCw
                className={`size-3.5 ${state.busy ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
            </button>
          </div>
        }
      >
        {!desktop ? (
          <p className="px-4 py-3.5 text-[13px] text-content/55">
            {t("Native session import is available in the desktop app.")}
          </p>
        ) : null}
        {(desktop ? NATIVE_SESSION_PROVIDERS : []).map((provider) => {
          const files = byProvider.get(provider) ?? [];
          const expanded = open === provider;
          const fresh = files.filter((file) => !isBound(file)).length;
          const matches = files.filter((file) =>
            `${file.title ?? ""} ${file.preview ?? ""} ${file.cwd} ${file.providerSessionId}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          );
          return (
            <div
              key={provider}
              data-native-provider={provider}
              className="border-b border-content/5 last:border-b-0"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-content/10 bg-background text-content">
                  <HarnessIcon harness={provider} className="size-5.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] text-content">
                    {nativeProviderLabel(provider)}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-content/45">
                    {files.length
                      ? t(
                          "{count} conversations · {fresh} not imported · latest {time}",
                          {
                            count: files.length,
                            fresh,
                            time: relative(files[0].modifiedAt, language),
                          },
                        )
                      : state.busy
                        ? t("Scanning…")
                        : t("No conversations found")}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={expanded}
                  className={pillClass}
                  disabled={!files.length}
                  onClick={() => toggle(provider)}
                >
                  {expanded ? t("Done") : t("Import")}
                </button>
              </div>
              <AnimatedCollapse expanded={expanded}>
                <div className="px-4 pb-3">
                  {fresh ? (
                    <div className="mb-2 flex justify-end">
                      <button
                        type="button"
                        className={pillClass}
                        disabled={!!bulk || state.busy}
                        onClick={() => void importAll(files)}
                      >
                        {t("Import all from {app} ({count})", {
                          app: nativeProviderLabel(provider),
                          count: fresh,
                        })}
                      </button>
                    </div>
                  ) : null}
                  {files.length > 8 ? (
                    <label className="mb-2 flex items-center gap-2 rounded-lg border border-content/10 px-2.5 py-1.5 text-[13px]">
                      <Search className="size-3.5 text-content/40" />
                      <input
                        aria-label={t("Search native sessions")}
                        placeholder={t(
                          "Search by title, project or session ID",
                        )}
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setShown(PAGE);
                        }}
                        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-content/35"
                      />
                    </label>
                  ) : null}
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-content/8">
                    {matches.slice(0, shown).map((file) => {
                      const key = nativeSourceKey(file);
                      const bound = isBound(file);
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-3 border-b border-content/5 px-3 py-2 last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-[13px] text-content"
                              title={file.title ?? file.preview}
                            >
                              {file.title ||
                                file.preview ||
                                file.cwd.split("/").pop() ||
                                file.cwd}
                            </div>
                            <div
                              className="truncate text-[11px] text-content/40"
                              title={`${file.cwd}\n${file.providerSessionId}`}
                            >
                              {file.cwd} · {relative(file.modifiedAt, language)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={pillClass}
                            disabled={!!pending || !!bulk}
                            onClick={() => void importFile(file)}
                          >
                            {pending === key
                              ? t("Importing…")
                              : bound
                                ? t("Open")
                                : t("Import")}
                          </button>
                        </div>
                      );
                    })}
                    {!matches.length ? (
                      <p className="px-3 py-2 text-[12px] text-content/45">
                        {t("No native sessions found.")}
                      </p>
                    ) : null}
                  </div>
                  {matches.length > shown ? (
                    <button
                      type="button"
                      onClick={() => setShown((value) => value + PAGE)}
                      className="mt-1.5 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/3 hover:text-content"
                    >
                      {t("Show more ({count})", {
                        count: matches.length - shown,
                      })}
                    </button>
                  ) : null}
                </div>
              </AnimatedCollapse>
            </div>
          );
        })}
      </Card>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 whitespace-pre-wrap text-[12px] text-red-500"
        >
          {state.error}
        </p>
      ) : null}
      {state.warnings.length ? (
        <details className="mt-3 text-[12px] text-content/45">
          <summary className="cursor-default">
            {t("Some native sessions could not be read ({count})", {
              count: state.warnings.length,
            })}
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">
            {state.warnings.join("\n")}
          </pre>
        </details>
      ) : null}
    </>
  );
}
