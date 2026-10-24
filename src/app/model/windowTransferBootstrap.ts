import { takeWindowTransfer } from "../../platform/tauri/appShell";
import type { WindowTransferPayload } from "./windowTransfer";
import { withoutRetiredSessions } from "../../features/workspace/model/workspaceSnapshot";

let transferPromise: Promise<WindowTransferPayload | null> | null = null;

/** One take per webview — safe under React StrictMode double-mount. */
export function loadWindowTransfer(): Promise<WindowTransferPayload | null> {
  if (!transferPromise) {
    transferPromise = takeWindowTransfer()
      .then((raw) =>
        raw ? withoutRetiredSessions(JSON.parse(raw) as WindowTransferPayload) : null,
      )
      .catch(() => null);
  }
  return transferPromise;
}
