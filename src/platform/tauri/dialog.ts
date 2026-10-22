import { ask, type ConfirmDialogOptions } from "@tauri-apps/plugin-dialog";

/** Native confirmation for actions that need an explicit user decision. */
export function confirmAction(message: string, options: ConfirmDialogOptions): Promise<boolean> {
  return ask(message, options);
}
