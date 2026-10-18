import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  INBOX_SOURCE_LABELS,
  type ConnectableInboxSource,
} from "../model/inboxFilters";
import { InboxProviderMark } from "./InboxProviderMark";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { MenuHover } from "../../../shared/ui/MenuHover";

const WIDTH = 188;

export function InboxConnectMenu({
  anchor,
  sources,
  onConnect,
  onClose,
}: {
  anchor: PopoverAnchor;
  sources: ConnectableInboxSource[];
  onConnect: (source: ConnectableInboxSource) => void;
  onClose: () => void;
}) {
  const { t: uiT } = useTranslation();
  return (
    <Popover
      anchor={anchor}
      gap={4}
      width={WIDTH}
      onDismiss={onClose}
      role="menu"
      aria-label={uiT("Connect an inbox source")}
      onContextMenu={(event) => event.preventDefault()}
      className="p-1"
    >
      <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
        {uiT("Not connected")}
      </div>
      {sources.map((source) => (
        <button
          key={source}
          type="button"
          role="menuitem"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onClose();
            onConnect(source);
          }}
          className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-5 text-content hover:bg-content/3"
        >
          <MenuHover />
          <InboxProviderMark
            provider={source}
            className="block size-3.5 shrink-0"
          />
          <span data-menu-title className="min-w-0 flex-1 truncate">
            {uiT("Connect ")}
            {INBOX_SOURCE_LABELS[source]}
          </span>
        </button>
      ))}
    </Popover>
  );
}
