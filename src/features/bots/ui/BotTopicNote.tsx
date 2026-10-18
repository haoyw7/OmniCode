import { useEffect, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { LoaderCircle, RefreshCw } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import type { BotMemoryTopic } from "../model/botView";
import type { BotTopicNote as TopicNote } from "../model/useBotTopicNotes";

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
  const [doc, setDoc] = useState<BotMemoryTopic | null>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const { rpc } = note.source;
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    setError(undefined);
    void rpc<BotMemoryTopic | null>("assistant.memoryTopic", { topic: note.name }).then(
      (value) => {
        if (!disposed) {
          setDoc(value);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      },
    );
    return () => { disposed = true; };
  }, [rpc, note.name, active, reload]);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("Assistant memory")}>
      <div className="flex shrink-0 items-start gap-3 border-b border-stroke p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-content/50">{note.source.name} · {t("Read only")}</p>
          <h2 className="desktop-pane-heading break-words text-lg font-semibold">{note.name}</h2>
        </div>
        <button
          type="button"
          aria-label={t("Refresh notes")}
          title={t("Refresh notes")}
          disabled={loading || !active}
          onClick={() => setReload((value) => value + 1)}
          className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-content/6 disabled:opacity-40"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-mobile-page-scroll>
        {loading ? (
          <LoaderCircle className="size-5 animate-spin" role="status" aria-label={t("Loading notes…")} />
        ) : error ? (
          <p role="alert" className="text-sm text-content/60">
            {error} <button type="button" disabled={!active} onClick={() => setReload((value) => value + 1)}>{t("Retry")}</button>
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
