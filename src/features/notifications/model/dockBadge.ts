import { setNativeDockBadge } from "../../../platform/tauri/notifications";
import { sessionNeedsInput } from "../../../domain/session";
import { type Session } from "../../../contracts/session";

let lastCount = -1;

/** Push the pending-approval count to the macOS Dock badge. */
export function syncDockBadge(sessions: Session[]): void {
  let count = 0;
  for (const session of sessions) {
    if (sessionNeedsInput(session)) count++;
  }
  if (count === lastCount) return;
  lastCount = count;
  void setNativeDockBadge(count).catch(() => {});
}
