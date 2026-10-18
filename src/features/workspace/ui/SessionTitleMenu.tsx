import { useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Popover } from "../../../shared/ui/Popover";
import { useSessionHeaderActions } from "./SessionHeaderActions";

/** The existing rename flow, shared by the overflow menu and title double-click. */
export function SessionRenamePopover({
  sessionId,
  title,
  anchor,
  onClose,
}: {
  sessionId: string;
  title: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const actions = useSessionHeaderActions();
  const [draft, setDraft] = useState(title);
  if (!actions) return null;

  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="start"
      width={280}
      constrainHeight={false}
      onDismiss={(reason) => {
        onClose();
        if (reason === "escape") anchor.focus();
      }}
    >
      <form
        className="p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          onClose();
          if (next && next !== title) actions.rename(sessionId, next);
          anchor.focus();
        }}
      >
        <input data-ui="input"
          autoFocus
          aria-label={t("Rename")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-md border border-content/15 bg-transparent px-2 text-[13px] text-content outline-none focus:border-accent"
        />
      </form>
    </Popover>
  );
}
