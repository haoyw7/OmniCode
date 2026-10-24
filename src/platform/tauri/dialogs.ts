import { ask, message, open, save } from "@tauri-apps/plugin-dialog";

type DialogOptions = {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
};

type FilePickerOptions = {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

/** Native sheets remain usable while menu accelerators own keyboard focus. */
export function confirmNativeAction(text: string, options?: DialogOptions): Promise<boolean> {
  return ask(text, options);
}

export async function showNativeMessage(text: string, options?: DialogOptions): Promise<void> {
  await message(text, options);
}

/** Picking a path grants no file execution authority; Host handles project IO. */
export function pickNativeFile(options?: FilePickerOptions): Promise<string | null> {
  return open({ ...options, multiple: false, directory: false });
}

export function pickNativeSavePath(options?: FilePickerOptions): Promise<string | null> {
  return save(options);
}
