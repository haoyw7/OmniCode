import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { toast } from "sonner";
import { PanelLeft, RotateCcw } from "../../../shared/ui/icons";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { ResizableRegion } from "../../../shared/ui/primitives/Resizable";
import { inboxItemRef, type InboxItem } from "../model/githubTasks";
import { inboxAskKey } from "../model/inboxAsk";

export type InboxSessionPortal = { sessionId: string; host: HTMLElement };
let rememberedWidth = 440;

/** Only a destination for the regular session pane; it owns no chat state. */
export function InboxDiscussionPanel({
  item,
  onClose,
  onOpen,
  onRestart,
  onMount,
}: {
  item: InboxItem;
  onClose: () => void;
  onOpen: (item: InboxItem) => Promise<string>;
  onRestart: (item: InboxItem) => Promise<string>;
  onMount: (portal: InboxSessionPortal | null) => void;
}) {
  const { t: uiT } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const openMutation = useMutation({
    mutationFn: ({ item, open }: { item: InboxItem; open: (item: InboxItem) => Promise<string> }) => open(item),
    onError: (reason) => toast.error(errorMessage(reason)),
  }, queryClient);
  const { mutateAsync } = openMutation;
  const error = errorMessage(openMutation.error);
  const loading = openMutation.isPending;
  const resizePane = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(rememberedWidth);
  const key = inboxAskKey(item);
  const activeKey = useRef<string | null>(key);
  activeKey.current = key;
  useEffect(() => {
    let active = true;
    activeKey.current = key;
    void mutateAsync({ item, open: onOpen })
      .then((sessionId) => {
        if (active && host.current) onMount({ sessionId, host: host.current });
      })
      .catch(() => {});
    return () => {
      active = false;
      if (activeKey.current === key) activeKey.current = null;
      onMount(null);
    };
    // Metadata refreshes for the same item must not remount its composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onOpen, onMount, mutateAsync]);

  return (
    <aside
      ref={resizePane}
      aria-label={uiT("Ask about {value0}", {
        value0: String(inboxItemRef(item)),
      })}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-stroke pl-4 max-[1100px]:absolute max-[1100px]:inset-0 max-[1100px]:z-10 max-[1100px]:!w-auto max-[1100px]:pl-0"
    >
      <ResizableRegion targetRef={resizePane} edge="left" size={width} min={360} max={() => Math.max(360, window.innerWidth - 650)} defaultSize={440}
        label={uiT("Resize discussion")} className="max-[1100px]:hidden" onCommit={next => { rememberedWidth = next; setWidth(next); }} />
      <header className="desktop-toolbar flex h-11 shrink-0 items-center border-b border-stroke px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {uiT("Ask · ")}
          {inboxItemRef(item)}
        </span>
        <IconButton size="sm"
          label={uiT("Restart conversation")}
          disabled={loading}
          onClick={() => {
            if (loading) return;
            openMutation.mutate({ item, open: onRestart }, {
              onSuccess: (sessionId) => {
                if (activeKey.current === key && host.current) onMount({ sessionId, host: host.current });
              },
            });
          }}
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label={uiT("Close panel")} onClick={onClose}>
          <PanelLeft className="size-3.5" />
        </IconButton>
      </header>
      {error ? (
        <p role="alert" className="p-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div ref={host} className="flex min-h-0 min-w-0 flex-1 flex-col" />
    </aside>
  );
}
