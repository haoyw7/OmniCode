import { getCurrentWebview } from "@tauri-apps/api/webview";

export type NativeFileDrop =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

/** OS drop paths belong to the shell; consumers choose how to import them. */
export function subscribeNativeFileDrop(handler: (event: { payload: NativeFileDrop }) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent(handler);
}

export function setNativePageZoom(scale: number): Promise<void> {
  return getCurrentWebview().setZoom(scale);
}
