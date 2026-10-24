import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/model/settings";

export const WORKSPACE_MODE_SHORTCUT = `${MOD}${SHIFT}G`;

export function isWorkspaceModeShortcut(event: {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return keybindingPressed(
    "Composer: Toggle Workspace",
    event,
    (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "g",
  );
}
