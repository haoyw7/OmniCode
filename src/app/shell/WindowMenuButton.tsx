import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ListFilter } from "../../shared/ui/icons";
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
        className="hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 desktop-window-menu"
        aria-label={t("Main menu")}
        title={t("Main menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tauri-drag-region="false"
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter />
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
