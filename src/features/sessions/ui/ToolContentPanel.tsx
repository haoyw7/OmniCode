import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "../../../shared/ui/forms/Button";
import { Skeleton } from "../../../shared/ui/primitives/Skeleton";
import { ReadonlyTextView } from "../../../shared/ui/ReadonlyTextView";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { queryClient } from "../../../shared/lib/queryClient";
import type { ToolContentField, ToolContentPage, ToolContentRef, ToolContentSource } from "../../../integrations/harness/core/toolContent";
import { readCompleteToolContent, toolContentQuery } from "../model/toolContentQueries";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error: /, "").replace(/^Host rejected request: /, "");

const LABELS: Record<ToolContentField, string> = { output: "Output", input: "Input", detail: "Details",
  previewOutput: "Output", diff: "Changes", text: "Details", title: "Command", previewTitle: "Command", query: "Query" };

export function ToolContentPanel({ reference, active = true, renderDiff }: {
  reference: ToolContentRef; active?: boolean;
  renderDiff?: (lines: NonNullable<ToolContentPage["lines"]>) => ReactNode;
}) {
  const { toolContent: source } = useContext(TranscriptPlatformContext);
  const { t } = useTranslation();
  if (!source) return <p role="status">{t("Connect to load tool details.")}</p>;
  return <div data-tool-content="" className="flex min-w-0 flex-col gap-3">
    {reference.fields.filter(field => !field.aliasOf && field.characters > 0).map(field =>
      <ToolContentFieldView key={JSON.stringify([source.key, reference.blockPath, reference.step, field.name])}
        source={source} reference={reference} field={field.name} active={active} renderDiff={renderDiff} />)}
  </div>;
}

function ToolContentFieldView({ source, reference, field, active, renderDiff }: {
  source: ToolContentSource; reference: ToolContentRef; field: ToolContentField; active: boolean;
  renderDiff?: (lines: NonNullable<ToolContentPage["lines"]>) => ReactNode;
}) {
  const { t } = useTranslation();
  const { copyText, toolContentSelection } = useContext(TranscriptPlatformContext);
  const visible = useSurfaceVisibility() && active;
  const [cursor, setCursor] = useState<{ refVersion: string; transfer: string; version: string; offset?: number; end?: number; tail?: boolean }>();
  const selected = toolContentSelection?.blockId === reference.blockPath[0] && toolContentSelection.field === field
    ? toolContentSelection : undefined;
  const pageCursor = cursor?.refVersion === reference.version ? cursor : undefined;
  useEffect(() => setCursor(undefined), [selected?.query, selected?.offset]);
  const request = { sessionId: reference.sessionId, blockPath: reference.blockPath, step: reference.step, field,
    version: pageCursor?.version ?? reference.version, transfer: pageCursor?.transfer,
    offset: pageCursor ? pageCursor.offset : selected?.offset, end: pageCursor?.end,
    tail: pageCursor?.tail ?? (!selected && ["output", "previewOutput", "detail"].includes(field)) };
  const result = useQuery({ ...toolContentQuery(source, request), enabled: visible,
    placeholderData: keepPreviousData,
    refetchInterval: query => visible && !pageCursor && !selected && !query.state.error && query.state.data?.running ? 1000 : false,
    refetchIntervalInBackground: false,
  }, queryClient);
  const page = result.data;
  const copying = useRef<AbortController | undefined>(undefined);
  useEffect(() => { if (!visible) copying.current?.abort(); return () => copying.current?.abort(); }, [visible]);
  const copy = useMutation({ networkMode: "always", mutationFn: async () => {
    copying.current?.abort(); const abort = new AbortController(); copying.current = abort;
    const text = await readCompleteToolContent(source, { ...request, offset: 0, tail: false, end: undefined,
      transfer: page?.transfer, version: page?.version ?? reference.version }, abort.signal);
    abort.signal.throwIfAborted();
    await copyText(text);
  } });
  const busy = !visible || result.isFetching || copy.isPending;
  const change = (next: { offset?: number; end?: number; tail?: boolean }) => {
    if (page) setCursor({ refVersion: reference.version, transfer: page.transfer, version: page.version, ...next });
  };
  return <section className="min-w-0" aria-busy={result.isFetching || undefined} data-tool-content-field={field}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{t(LABELS[field])}</span>
      <Button variant="ghost" size="sm" disabled={busy || !page} onClick={() => copy.mutate()}>
        {t(copy.isPending ? "Copying…" : copy.isSuccess ? "Copied" : "Copy complete content")}
      </Button>
    </div>
    {result.isPending && <Skeleton className="h-20 w-full" />}
    {result.error && <div role="alert" className="text-sm">
      {t(errorMessage(result.error))}
      <Button variant="ghost" size="sm" disabled={!visible || result.isFetching} onClick={() => {
        if (pageCursor) { void queryClient.invalidateQueries({ queryKey: ["toolContent", ...source.key], refetchType: "none" }); setCursor(undefined); }
        else void result.refetch();
      }}>{t("Retry")}</Button>
    </div>}
    {copy.error && <p role="alert" className="text-sm">{t(errorMessage(copy.error))}</p>}
    {page && <>
      {(page.start > 0 || page.end < page.total) && <p role="status" className="text-xs text-muted-foreground">
        {t("Showing characters {start}–{end} of {total}.", { start: page.start + 1, end: page.end, total: page.total })}
      </p>}
      {field === "diff" && page.lines && renderDiff ? renderDiff(page.lines) :
        <ReadonlyTextView text={page.text} diff={field === "diff"} stateKey={JSON.stringify([source.key, reference.blockPath, field, page.version, page.start])} />}
      <div className="flex flex-wrap gap-2">
        {page.start > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={() => change({ end: page.start, tail: true })}>{t("Load earlier content")}</Button>}
        {page.end < page.total && <Button variant="ghost" size="sm" disabled={busy} onClick={() => change({ offset: page.end, tail: false })}>{t("Load more")}</Button>}
        {pageCursor && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCursor(undefined)}>{t("Latest content")}</Button>}
      </div>
    </>}
  </section>;
}
