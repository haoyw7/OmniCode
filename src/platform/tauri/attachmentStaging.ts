import { invoke } from "@tauri-apps/api/core";

/** Stage picked or pasted bytes in the app data directory before Host upload. */
export function stageDesktopAttachment(name: string, data: string): Promise<string> {
  return invoke("write_attachment", { name, data });
}
