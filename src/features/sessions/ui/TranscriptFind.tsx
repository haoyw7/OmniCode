import type { TranscriptHistory } from "../../../integrations/harness/core/history";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { cn } from "../../../shared/lib/cn";
import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, ChevronUp, Search, X } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import { findTranscriptBlocks } from "../model/transcriptFind";
import { keybindingPressed } from "../../settings/model/settings";

type Props = {
  blocks: Block[];
  historyPaging?: TranscriptHistory;
  visible: boolean;
  focused: boolean;
  onNavigate: (blockId: string | null, query?: string) => boolean;
  side?: "left" | "right";
};

export function TranscriptFind({
  blocks,
  historyPaging,
  visible,
  focused,
  onNavigate,
  side = "right",
}: Props) {
  const { t: uiT } = useTranslation();
  const { toolContent: source, selectToolContent } = useContext(TranscriptPlatformContext);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const localMatches = useMemo(
    () => findTranscriptBlocks(blocks, query),
    [blocks, query],
  );
  const historyLoad = useMutation({ mutationFn: async () => { await historyPaging?.loadEarlier(); }, networkMode: "always" }, queryClient);
  const pageOffset = Math.floor(active / 100) * 100;
  const remote = useQuery({
    queryKey: ["toolContentSearch", ...(source?.key ?? []), query.trim(), pageOffset],
    enabled: !!source?.search && open && visible && !!query.trim(),
    queryFn: ({ signal }) => source!.search!(query.trim(), pageOffset, signal),
    placeholderData: keepPreviousData,
    networkMode: "always",
    retry: false, gcTime: 0,
  }, queryClient);
  const matches = source?.search ? (remote.data?.ids ?? []) : localMatches;
  const total = source?.search ? remote.data?.total ?? 0 : matches.length;
  const selected = remote.isPlaceholderData ? null : matches[source?.search ? active - pageOffset : active] ?? null;
  useEffect(() => {
    if (source?.search && open && visible && query.trim())
      void queryClient.invalidateQueries({ queryKey: ["toolContentSearch", ...source.key] });
  }, [blocks, source, open, visible]);
  useEffect(() => { if (total && active >= total) setActive(total - 1); }, [total, active]);

  const openFind = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const closeFind = () => {
    setOpen(false);
    historyLoad.reset();
    onNavigate(null);
    selectToolContent?.(undefined);
  };
  const step = (direction: number) => {
    if (!total || remote.isFetching) return;
    setActive((index) => (index + direction + total) % total);
  };

  useEffect(() => {
    if (!open || !visible) return;
    const frame = requestAnimationFrame(() => {
      const found = onNavigate(selected, query);
      if (selected && !found && historyPaging?.hasMore && !historyLoad.isPending && !historyLoad.error) historyLoad.mutate();
      const hit = selected ? remote.data?.hits?.[selected] : undefined;
      selectToolContent?.(selected && hit ? { blockId: selected, ...hit, query } : undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, visible, selected, query, onNavigate, remote.data, selectToolContent, blocks, historyPaging?.hasMore, historyLoad.isPending, historyLoad.error]);

  useEffect(() => {
    if (!visible || !focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          ".cm-editor, .omnicode-terminal, [role='dialog'], [data-app-search]",
        )
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      const defaultFind =
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f";
      if (keybindingPressed("Editor: Find", event, defaultFind)) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
      } else if (defaultFind) {
        event.preventDefault();
        event.stopPropagation();
      } else if (
        open &&
        (event.key === "F3" ||
          (mod && !event.altKey && event.key.toLowerCase() === "g"))
      ) {
        event.preventDefault();
        event.stopPropagation();
        step(event.shiftKey ? -1 : 1);
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!visible || !open) return null;

  return (
    <div
      className={cn("pointer-events-none absolute inset-x-3 top-2 z-40 flex", side === "left" ? "justify-start" : "justify-end")}
    >
      <div
        role="search"
        aria-label={uiT("Find in conversation")}
        className="pointer-events-auto flex w-[360px] max-w-full items-center gap-1 rounded-lg border border-content/10 bg-content/5 p-1 shadow-lg backdrop-blur-xl"
      >
        <Search
          className="ml-1 size-3.5 shrink-0 text-content/50"
        />
        <Input variant="inline"
          ref={input}
          type="text"
          value={query}
          aria-label={uiT("Find in conversation")}
          placeholder={uiT("Find in conversation")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            historyLoad.reset();
            setActive(0);
          }}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          className="w-44 min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none focus-visible:focus-fill placeholder:text-content/40"
        />
        <span
          aria-live="polite"
          className="min-w-[10ch] shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular-nums text-content/50"
        >
          {(remote.isFetching || historyLoad.isPending) ? uiT("Loading…") : (remote.error || historyLoad.error) ? uiT("Search failed") : query.trim()
            ? matches.length
              ? uiT("{value0} of {value1}", {
                  value0: String(active + 1),
                  value1: String(total),
                })
              : uiT("No results")
            : ""}
        </span>
        <FindButton
          label={uiT("Previous match")}
          onClick={() => step(-1)}
          disabled={!matches.length || remote.isFetching}
        >
          <ChevronUp className="size-3.5" />
        </FindButton>
        <FindButton
          label={uiT("Next match")}
          onClick={() => step(1)}
          disabled={!matches.length || remote.isFetching}
        >
          <ChevronDown className="size-3.5" />
        </FindButton>
        {(remote.error || historyLoad.error) && <Button variant="ghost" size="sm" onClick={() => { historyLoad.reset(); void remote.refetch(); }}>{uiT("Retry")}</Button>}
        <FindButton label={uiT("Close find")} onClick={closeFind}>
          <X className="size-3.5" />
        </FindButton>
      </div>
    </div>
  );
}

function FindButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="content"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded text-content/55 hover:bg-content/6 hover:text-content disabled:opacity-30"
    >
      {children}
    </Button>
  );
}
