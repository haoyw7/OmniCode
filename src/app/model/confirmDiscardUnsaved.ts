import { ask } from "@tauri-apps/plugin-dialog";

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
export function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return ask(message, { title: "OmniCode", kind: "warning" });
}
