import { Button } from "../../../shared/ui/forms/Button";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botTopicQuery } from "../model/botQueries";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { RefreshCw } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import type { BotTopicNote as TopicNote } from "../model/useBotTopicNotes";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

/** Mounted with the topic key: a late reply cannot replace a different topic. */
export function BotTopicNote({
  note,
  active = true,
}: {
  note: TopicNote;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  active = active && visible;
  const query = useQuery({ ...botTopicQuery(note.source.key, note.name, note.source.rpc), enabled: active }, queryClient);
  const doc = query.data;
  const loading = query.isPending;
  const error = query.error ? query.error instanceof Error ? query.error.message : String(query.error) : undefined;
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("Assistant memory")}>
      <div className="flex shrink-0 items-start gap-3 border-b border-stroke p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-content/50">{note.source.name} · {t("Read only")}</p>
          <h2 className="desktop-pane-heading break-words text-lg font-semibold">{note.name}</h2>
        </div>
        <Button variant="ghost" size="content"
          type="button"
          aria-label={t("Refresh notes")}
          title={t("Refresh notes")}
          disabled={loading || !active}
          onClick={() => void query.refetch()}
          className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-content/6 disabled:opacity-40"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-mobile-page-scroll>
        {loading ? (
          <Spinner className="size-5" role="status" aria-label={t("Loading notes…")} />
        ) : error ? (
          <p role="alert" className="text-sm text-content/60">
            {error} <Button variant="ghost" size="content" type="button" disabled={!active} onClick={() => void query.refetch()}>{t("Retry")}</Button>
          </p>
        ) : doc ? (
          <AgentMarkdown text={doc.text} hardBreaks />
        ) : (
          <p className="text-sm text-content/50">{t("Note was not found.")}</p>
        )}
      </div>
    </section>
  );
}
