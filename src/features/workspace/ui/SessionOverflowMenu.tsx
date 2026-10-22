import { Button } from "../../../shared/ui/forms/Button";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useEffect, useRef, useState } from "react";
import { useCommandShortcut } from "../../../app/commands/useCommandShortcut";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  Archive,
  Bot,
  MoreHorizontal,
  PanelRight,
  Pencil,
} from "../../../shared/ui/icons";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ActionMenu } from "../../../shared/ui/primitives/ActionMenu";
import type { Session } from "../../sessions/model/session";
import { useSessionHeaderActions } from "./SessionHeaderActions";
import { delegateDesktopSession } from "../../bots/model/delegateDesktopSession";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { remoteSessionFor } from "../../connections/model/connections";

/** The chat column's ⋯ menu: actions for the owning session. */
export function SessionOverflowMenu({
  session,
  onRename,
}: {
  session: Session;
  onRename: (anchor: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const actions = useSessionHeaderActions();
  const visible = useSurfaceVisibility();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const splitShortcut = useCommandShortcut("Pane: Split Right");
  const archiveShortcut = useCommandShortcut("Session: Archive");
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  if (!actions) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      <Button variant="ghost" size="content"
        ref={button}
        type="button"
        data-session-overflow-menu={session.id}
        data-menu-trigger="session"
        data-tauri-drag-region="false"
        aria-label={t("More actions")}
        title={t("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((current) => !current)}
        className="mr-1 grid size-7.5 shrink-0 self-center place-items-center rounded-md text-content/60 hover:bg-content/3 hover:text-content"
      >
        <MenuHover />
        <MoreHorizontal className="size-4" />
      </Button>
      <PresenceBoundary propagate>{visible && open && button.current ? (
        <ActionMenu
          anchor={button.current}
          ownerId={session.id}
          side="bottom"
          align="end"
          width={280}
          ariaLabel={t("Session actions")}
          items={[
            ...(remoteProjectFor(session.cwd) ? [{
              kind: "item" as const,
              id: "delegate-assistant",
              label: t("Hand over to assistant"),
              icon: <Bot className="size-4" />,
            }] : []),
            {
              kind: "item",
              id: "rename",
              label: t("Rename"),
              icon: <Pencil className="size-4" />,
            },
            {
              kind: "item",
              id: "split",
              label: t("Split Right"),
              icon: <PanelRight className="size-4" />,
              shortcut: splitShortcut ?? undefined,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "archive",
              label: t("Archive"),
              icon: <Archive className="size-4" />,
              shortcut: archiveShortcut ?? undefined,
            },
          ]}
          onPick={(id) => {
            if (id === "rename") {
              setOpen(false);
              onRename(button.current!);
              return;
            }
            close();
            if (id === "delegate-assistant") void delegateDesktopSession(session.cwd, remoteSessionFor(session.id) ?? session.id);
            else if (id === "split") actions.splitRight(session.id);
            else if (id === "archive") actions.archive(session.id);
          }}
          onClose={close}
        />
      ) : null}</PresenceBoundary>
    </>
  );
}
