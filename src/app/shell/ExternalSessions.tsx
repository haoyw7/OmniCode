import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import { ChevronDown, ChevronRight } from "../../shared/ui/icons";
import { withStatusToast } from "../../shared/ui/StatusToast";
import { pathKey } from "../../shared/lib/paths";
import {
  externalNativeSessions,
  importNativeSession,
  nativeSessionSnapshot,
  refreshNativeDiscovery,
  subscribeNativeSessions,
} from "../../features/sessions/data/nativeSessions";
import {
  nativeProviderLabel,
  nativeSourceKey,
  type NativeSessionFile,
} from "../../integrations/harness/core/nativeSessions";

const PAGE = 5;

function belongsTo(projectPath: string) {
  const root = pathKey(projectPath).replace(/\/+$/, "");
  return (cwd: string) => {
    const key = pathKey(cwd).replace(/\/+$/, "");
    return key === root || key.startsWith(`${root}/`);
  };
}

function age(ms: number, now: number, locale: string): string {
  const minutes = Math.round((ms - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

/**
 * Sessions that a native CLI created in this project and MonoCode has not
 * imported yet. Selecting one imports it and opens it.
 */
export function ExternalSessions({
  projectPath,
  onOpen,
}: {
  projectPath: string;
  onOpen: (id: string) => void;
}) {
  const { t, language } = useTranslation();
  const state = useSyncExternalStore(
    subscribeNativeSessions,
    nativeSessionSnapshot,
    nativeSessionSnapshot,
  );
  const [expanded, setExpanded] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void refreshNativeDiscovery();
  }, []);
  const files = useMemo(
    () =>
      externalNativeSessions(state.files, state.bound, belongsTo(projectPath)),
    [state.files, state.bound, projectPath],
  );
  if (!files.length) return null;
  const now = Date.now();
  const open = async (file: NativeSessionFile) => {
    const key = nativeSourceKey(file);
    setPending(key);
    setError(undefined);
    try {
      const id = await withStatusToast(() => importNativeSession(file), {
        loading: t("Importing conversation…"),
        success: (id) => !!id && t("Conversation imported"),
        error: false,
      });
      if (id) onOpen(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(undefined);
    }
  };
  return (
    <div data-external-sessions className="px-1 pb-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-content/50 hover:bg-content/3 hover:text-content/75"
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {t("External sessions ({count})", { count: files.length })}
        </span>
      </button>
      <AnimatedCollapse expanded={expanded}>
        <div className="flex flex-col gap-px">
          {files.slice(0, shown).map((file) => {
            const key = nativeSourceKey(file);
            const label =
              file.title || file.preview || file.providerSessionId.slice(0, 12);
            return (
              <button
                key={key}
                type="button"
                disabled={!!pending}
                title={`${nativeProviderLabel(file.provider)} · ${file.cwd}\n${file.providerSessionId}`}
                onClick={() => void open(file)}
                className="group flex h-7 items-center gap-2 rounded-md px-2 text-left text-sm text-content/55 hover:bg-content/3 hover:text-content/85 disabled:opacity-60"
              >
                <span className="shrink-0 rounded border border-content/15 px-1 text-[10px] leading-4 text-content/50">
                  {nativeProviderLabel(file.provider)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {pending === key ? t("Importing…") : label}
                </span>
                <span className="shrink-0 text-[11px] text-content/35">
                  {age(file.modifiedAt, now, language)}
                </span>
              </button>
            );
          })}
          {files.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((value) => value + 10)}
              className="h-6 rounded-md px-2 text-left text-xs text-content/45 hover:bg-content/3 hover:text-content/70"
            >
              {t("Show more ({count})", { count: files.length - shown })}
            </button>
          ) : null}
          {error ? (
            <p role="alert" className="px-2 py-1 text-xs text-red-500">
              {error}
            </p>
          ) : null}
        </div>
      </AnimatedCollapse>
    </div>
  );
}
