import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useEffect, useRef, useState } from "react";
import { useCommandShortcut } from "../../../app/commands/useCommandShortcut";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  Archive,
  Bot,
  IconArtworkContext,
  MoreHorizontal,
  PanelRight,
  Pencil,
  type IconComponent,
} from "../../../shared/ui/icons";
import { MenuHover } from "../../../shared/ui/MenuHover";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ExplorerMenu } from "../../connections/files/ui/ExplorerMenu";
import type { Session } from "../../sessions/model/session";
import { useSessionHeaderActions } from "./SessionHeaderActions";
import { delegateDesktopSession } from "../../bots/model/delegateDesktopSession";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { remoteSessionFor } from "../../connections/model/connections";

const sessionActionIconArtwork = {
  Bot: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="7" width="14" height="13" rx="2" strokeWidth="1.5" />
      <path d="M12 7V4h-2M4 12h1m14 0h1M9 11v2m6-2v2m-6 4h6" strokeWidth="1.5" />
    </g>
  ),
  Pencil: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 20 1-5L16 4l4 4L9 19l-5 1ZM13 7l4 4" strokeWidth="1.5" />
    </g>
  ),
  PanelRight: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5" />
      <path d="M15 4v16" strokeWidth="1.5" />
    </g>
  ),
  Archive: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="4" rx="1" strokeWidth="1.5" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M9 12h6" strokeWidth="1.5" />
    </g>
  ),
};

/** Scope the square artwork to session menu actions. */
function SessionActionIcon({ icon: Icon }: { icon: IconComponent }) {
  return (
    <IconArtworkContext.Provider value={sessionActionIconArtwork}>
      <Icon className="size-4" />
    </IconArtworkContext.Provider>
  );
}

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
      <button
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
      </button>
      <PresenceBoundary propagate>{visible && open && button.current ? (
        <ExplorerMenu
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
              icon: <SessionActionIcon icon={Bot} />,
            }] : []),
            {
              kind: "item",
              id: "rename",
              label: t("Rename"),
              icon: <SessionActionIcon icon={Pencil} />,
            },
            {
              kind: "item",
              id: "split",
              label: t("Split Right"),
              icon: <SessionActionIcon icon={PanelRight} />,
              shortcut: splitShortcut ?? undefined,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "archive",
              label: t("Archive"),
              icon: <SessionActionIcon icon={Archive} />,
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
