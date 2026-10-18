import { useSyncExternalStore } from "react";
import { subscribeKeybindings } from "../../features/settings/model/settings";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { commandShortcutLabel } from "./registry";

/** The command's effective shortcut label, updated when the user rebinds it. */
export function useCommandShortcut(id: string): string | null {
  const read = () => commandShortcutLabel(id);
  return useSyncExternalStore(subscribeKeybindings, read, read);
}

/**
 * A tooltip such as "Close Pane (Ctrl+W)" that follows the user's rebinding,
 * or just the translated label when the shortcut is disabled.
 */
export function useShortcutLabel(label: string, id: string): string {
  const { t } = useTranslation();
  const shortcut = useCommandShortcut(id);
  return shortcut
    ? t("{label} ({shortcut})", { label: t(label), shortcut })
    : t(label);
}
