import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../features/connections/files/ui/ExplorerMenu";
import {
  loadAutosave,
  loadKeybindingOverrides,
  loadMenuBarVisible,
  subscribeAutosave,
  subscribeKeybindings,
  subscribeMenuBarVisible,
} from "../../features/settings/model/settings";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { PresenceBoundary } from "../../shared/ui/PresenceBoundary";
import { useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { MENUS, menuItems, type CommandHandlers } from "../commands/registry";
import type { CommandDispatch } from "../commands/useCommandDispatcher";

export function WindowMenuButton({
  handlers,
  dispatch,
}: {
  handlers: CommandHandlers;
  dispatch: CommandDispatch;
}) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const visible = useSurfaceVisibility();
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);
  const autosave = useSyncExternalStore(subscribeAutosave, loadAutosave);
  const menuBarVisible = useSyncExternalStore(
    subscribeMenuBarVisible,
    loadMenuBarVisible,
  );
  const [, refreshShortcuts] = useState(loadKeybindingOverrides);
  useEffect(
    () => subscribeKeybindings(() => refreshShortcuts(loadKeybindingOverrides())),
    [],
  );
  const items: ExplorerMenuItem[] = MENUS.flatMap(({ id, label }) => {
    const submenu = menuItems(id, {
      handlers,
      translate: t,
      checked: (command) =>
        command === "File: Autosave"
          ? autosave
          : command === "View: Toggle Menu Bar"
            ? menuBarVisible
            : false,
    }).filter((item) => item.kind === "item");
    return submenu.length
      ? [{ kind: "item" as const, id, label: t(label), submenu }]
      : [];
  });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-ui="icon-button"
        className="desktop-window-menu"
        aria-label={t("Main menu")}
        title={t("Main menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tauri-drag-region="false"
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4h16M4 12h12M4 20h8" />
        </svg>
      </button>
      <PresenceBoundary>
        {open && anchor.current ? (
          <ExplorerMenu
            anchor={anchor.current}
            side="bottom"
            align="start"
            ariaLabel={t("Main menu")}
            items={items}
            onPick={(id) => {
              setOpen(false);
              requestAnimationFrame(() => void dispatch(id));
            }}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </PresenceBoundary>
    </>
  );
}
