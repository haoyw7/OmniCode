import { confirmNativeAction } from "../../platform/tauri/dialogs";

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
export function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return confirmNativeAction(message, { title: "OmniCode", kind: "warning" });
}
