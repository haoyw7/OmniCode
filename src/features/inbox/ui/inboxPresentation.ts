import { createContext, useContext, type ComponentType } from "react";
import type { GithubPrDiff } from "../../../contracts/session";

export type InboxDiffProps = { diff: GithubPrDiff; fullFile?: boolean; focusPath?: string };

export const InboxDiffRendererContext = createContext<ComponentType<InboxDiffProps>>(() => {
  throw new Error("Inbox diff renderer is not configured");
});
export const useInboxDiffRenderer = () => useContext(InboxDiffRendererContext);
