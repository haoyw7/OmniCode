import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { Button } from "./forms/Button";
import { Input } from "./forms/Input";
import { Empty, EmptyDescription } from "./primitives/Empty";
import { Skeleton } from "./primitives/Skeleton";
import { ChevronRight, Folder } from "./icons";

/** One directory listing returned by a Host folder browse (`projects.browse`). */
export type HostFolderListing = {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
};

/** Browses folders through a Host (`projects.browse`) and returns one path.
 * Remount with a different `key` to browse another Host. */
export function HostFolderBrowser({ browse: request, initialPath, disabled, pickLabel, onCancel, onPick }: {
  browse: (path?: string) => Promise<HostFolderListing>;
  initialPath?: string;
  disabled: boolean;
  pickLabel: string;
  onCancel: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(initialPath ?? "");
  const [directory, setDirectory] = useState<HostFolderListing>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);

  const browse = async (next?: string) => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const value = await request(next);
      if (current !== version.current) return;
      setDirectory(value);
      setPath(value.path);
    } catch (reason) {
      if (current === version.current) setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (current === version.current) setLoading(false);
    }
  };

  useEffect(() => {
    void browse(initialPath || undefined);
    return () => { version.current++; };
  }, []);

  const rows = [
    ...(directory?.parent ? [{ name: "..", path: directory.parent }] : []),
    ...(directory?.entries ?? []),
  ];
  return (
    <div className="mb-1.5 flex flex-col gap-2 rounded-lg border border-border p-2 font-normal">
      <Input aria-label={t("Folder path on the machine")} className="font-mono" value={path} disabled={disabled}
        placeholder="/home/me/code/my-app" autoComplete="off" spellCheck={false}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void browse(path.trim() || undefined);
        }} />
      <div aria-label={t("Folders")} className="max-h-48 min-h-16 overflow-y-auto overscroll-contain">
        {rows.map((entry) => (
          <button key={entry.path} type="button" disabled={disabled} onClick={() => void browse(entry.path)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-base text-foreground transition-colors hover:bg-surface-hover">
            <Folder className="size-3.5 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
          </button>
        ))}
        {directory && !directory.entries.length ? (
          <Empty className="p-2">
            <EmptyDescription>{t("No subfolders")}</EmptyDescription>
          </Empty>
        ) : null}
        {!directory && loading ? (
          <div
            role="status"
            aria-label={t("Loading folders…")}
            className="space-y-2 p-2"
          >
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="whitespace-pre-wrap break-words text-ui-sm text-red-400">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>{t("Cancel")}</Button>
        <Button type="button" size="sm" disabled={disabled || !path.trim()} onClick={() => onPick(path.trim())}>
          {pickLabel}
        </Button>
      </div>
    </div>
  );
}
