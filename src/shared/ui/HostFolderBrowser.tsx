import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "../i18n/useTranslation";
import { queryClient } from "../lib/queryClient";
import { Button } from "./forms/Button";
import { Input } from "./forms/Input";
import { Field, FieldError } from "./primitives/Field";
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
export function HostFolderBrowser({
  browse: request,
  initialPath,
  disabled,
  pickLabel,
  onCancel,
  onPick,
}: {
  browse: (path?: string) => Promise<HostFolderListing>;
  initialPath?: string;
  disabled: boolean;
  pickLabel: string;
  onCancel: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const instanceId = useId();
  const form = useForm({
    resolver: zodResolver(
      z.object({ path: z.string().trim().min(1, t("Enter a folder path")) }),
    ),
    defaultValues: { path: initialPath ?? "" },
  });
  const path = useWatch({ control: form.control, name: "path" });
  const [browsePath, setBrowsePath] = useState(initialPath || undefined);
  const directoryQuery = useQuery(
    {
      // The callback has no Host identity. Scope its cache to this mounted browser;
      // callers already remount with a new key when switching Hosts.
      queryKey: ["host-folder-browser", instanceId, browsePath],
      queryFn: () => request(browsePath),
      gcTime: 0,
      refetchOnWindowFocus: false,
    },
    queryClient,
  );
  const directory = directoryQuery.data;
  const { setValue } = form;
  useEffect(() => {
    if (directory) setValue("path", directory.path, { shouldValidate: true });
  }, [directory, directoryQuery.dataUpdatedAt, setValue]);
  const browse = (next?: string) => {
    if (next === browsePath) void directoryQuery.refetch();
    else setBrowsePath(next);
  };

  const rows = [
    ...(directory?.parent ? [{ name: "..", path: directory.parent }] : []),
    ...(directory?.entries ?? []),
  ];
  return (
    <div className="mb-1.5 flex flex-col gap-2 rounded-lg border border-border p-2 font-normal">
      <Controller
        control={form.control}
        name="path"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <Input
              {...field}
              aria-label={t("Folder path on the machine")}
              className="font-mono"
              disabled={disabled}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                fieldState.error ? `${instanceId}-path-error` : undefined
              }
              placeholder="/home/me/code/my-app"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                browse(path.trim() || undefined);
              }}
            />
            <FieldError
              id={`${instanceId}-path-error`}
              errors={[fieldState.error]}
            />
          </Field>
        )}
      />
      <div
        aria-label={t("Folders")}
        aria-busy={directoryQuery.isFetching}
        className="max-h-48 min-h-16 overflow-y-auto overscroll-contain"
      >
        {rows.map((entry) => (
          <Button
            key={entry.path}
            type="button"
            variant="ghost"
            data-menu-row
            disabled={disabled}
            onClick={() => browse(entry.path)}
            className="w-full justify-start text-left"
          >
            <Folder className="size-3.5 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
          </Button>
        ))}
        {directory && !directory.entries.length ? (
          <Empty className="p-2">
            <EmptyDescription>{t("No subfolders")}</EmptyDescription>
          </Empty>
        ) : null}
        {!directory && directoryQuery.isLoading ? (
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
      {directoryQuery.error ? (
        <FieldError className="whitespace-pre-wrap break-words">
          {String(directoryQuery.error).replace(/^Error: /, "")}
        </FieldError>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || !path.trim()}
          onClick={form.handleSubmit(({ path: value }) => onPick(value))}
        >
          {pickLabel}
        </Button>
      </div>
    </div>
  );
}
