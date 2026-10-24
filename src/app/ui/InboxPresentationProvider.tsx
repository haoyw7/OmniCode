import type { ReactNode } from "react";
import { InboxDiffRendererContext } from "../../features/inbox/ui/inboxPresentation";
import { lazySurface } from "../../shared/ui/lazySurface";

const Diff = lazySurface(async () => ({ default: (await import("./InboxPrDiff")).InboxPrDiff }));

export function InboxPresentationProvider({ children }: { children: ReactNode }) {
  return <InboxDiffRendererContext.Provider value={Diff}>{children}</InboxDiffRendererContext.Provider>;
}
