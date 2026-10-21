import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { botResidentMemoryQuery } from "../model/botPanelQueries";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronRight } from "../../../shared/ui/icons";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import type { BotRpc } from "../model/botRpc";
import type { BotMemoryDetailProps } from "./BotChatChrome";

type MemoryControl =
  | { action: "addMemory"; fact: string }
  | { action: "editMemory"; index: number; fact: string }
  | { action: "forgetMemory"; index: number };

/**
 * The assistant's resident memory. Each fact opens in a platform panel for
 * editing or forgetting; edits apply at once,
 * like cancelling a reminder, and never touch the settings draft. Each edit
 * carries the version it was made against, so one written meanwhile by the
 * assistant or another device is reloaded instead of overwritten.
 */
export function BotMemoryEditor({
  rpc,
  revision,
  disabled,
  Detail,
  onReady,
}: {
  rpc: BotRpc;
  /** The Host's current memory version; a change reloads the list. */
  revision: number;
  disabled?: boolean;
  /** Platform panel; facts list on one line and open in it. */
  Detail: ComponentType<BotMemoryDetailProps>;
  onReady?: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const options = botResidentMemoryQuery(rpc);
  const query = useQuery(options, queryClient);
  const memory = query.data;
  const form = useForm({
    resolver: zodResolver(z.object({ fact: z.string().trim().min(1, t("This field is required")).max(1000, t("Use at most {count} characters", { count: 1000 })) })),
    defaultValues: { fact: "" },
  });
  const adding = useWatch({ control: form.control, name: "fact" });
  // The opened fact is retained while its panel animates closed.
  const [detail, setDetail] = useState<{
    index: number;
    text: string;
    meta?: string;
    open: boolean;
  }>();
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    void invalidateAfterChange(options.queryKey);
  }, [revision, rpc]);
  useEffect(() => { if (!query.isPending) onReady?.(true); }, [query.isPending, onReady]);
  useEffect(() => () => onReady?.(false), [onReady]);
  const notices: Record<MemoryControl["action"], [string, string]> = {
    addMemory: ["Adding memory…", "Memory added"],
    editMemory: ["Updating memory…", "Memory updated"],
    forgetMemory: ["Forgetting memory…", "Memory forgotten"],
  };
  const mutation = useMutation({
    mutationFn: (input: MemoryControl) => {
      const [loading, success] = notices[input.action];
      return withToast(() => rpc("assistant.control", {
        commandId: crypto.randomUUID(), expectedRevision: memory!.revision, ...input,
      }), { loading: t(loading), success: t(success) });
    },
    onSettled: () => invalidateAfterChange(options.queryKey),
  }, queryClient);
  const pending = mutation.isPending;
  const error = errorMessage(mutation.error ?? query.error);
  const control = async (input: MemoryControl) => {
    if (!memory) return false;
    try { await mutation.mutateAsync(input); return true; }
    catch { return false; }
  };
  const busy = disabled || pending || !memory;
  const facts = memory?.facts.filter((fact) => !fact.struck) ?? [];
  const factMeta = (fact: (typeof facts)[number]) =>
    [fact.date, fact.until && t("until {date}", { date: fact.until })]
      .filter(Boolean)
      .join(" · ") || undefined;
  const closeDetail = () =>
    setDetail((current) => current && { ...current, open: false });
  const add = form.handleSubmit(async ({ fact }) => {
    if (!busy && await control({ action: "addMemory", fact })) form.reset();
  });
  // The editor sits inside the settings form; Enter must not submit it.
  const onEnter =
    (submit: () => Promise<void>) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      void submit();
    };
  return (
    <div className="assistant-memory">
      {memory && !facts.length && (
        <p className="assistant-memory-empty">
          {t("Nothing remembered yet. The assistant saves lasting facts and preferences as it learns them.")}
        </p>
      )}
      {facts.length > 0 && (
        <ul className="assistant-memory-list" aria-label={t("Remembered facts")}>
          {facts.map((fact) => (
            <li key={`${fact.index}:${fact.text}`}>
              <button
                type="button"
                className="assistant-memory-row"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => {
                  mutation.reset();
                  setDetail({
                    index: fact.index,
                    text: fact.text,
                    meta: factMeta(fact),
                    open: true,
                  });
                }}
              >
                <time
                  className="assistant-memory-row-date"
                  dateTime={fact.date || undefined}
                >
                  {fact.date ?? ""}
                </time>
                <span className="assistant-memory-row-text">{fact.text}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="assistant-memory-add">
        <input data-ui="input"
          aria-label={t("Add a fact for the assistant to remember")}
          placeholder={t("Add a fact for the assistant to remember")}
          {...form.register("fact")}
          aria-invalid={!!form.formState.errors.fact}
          maxLength={1000}
          disabled={busy}
          onKeyDown={onEnter(add)}
        />
        <button data-ui="button" data-variant="secondary"
          type="button"
          disabled={busy || !adding.trim()}
          onClick={() => void add()}
        >
          {t("Add")}
        </button>
      </div>
      <FieldError errors={[form.formState.errors.fact]} />
      {!!memory?.topics.length && (
        <small>
          {t("Topic notes: {topics}", { topics: memory.topics.join(", ") })}
        </small>
      )}
      {error && !detail?.open && (
        <small className="assistant-field-error" role="alert">
          {error}
        </small>
      )}
      {detail && (
        <Detail
          open={detail.open}
          text={detail.text}
          meta={detail.meta}
          busy={busy}
          error={error}
          onClose={closeDetail}
          onSave={async (text) => {
            if (!text.trim() || text === detail.text) return;
            if (await control({ action: "editMemory", index: detail.index, fact: text }))
              closeDetail();
          }}
          onForget={async () => {
            if (await control({ action: "forgetMemory", index: detail.index }))
              closeDetail();
          }}
        />
      )}
    </div>
  );
}
