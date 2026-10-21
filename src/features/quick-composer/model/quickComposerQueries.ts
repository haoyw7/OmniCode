import { queryOptions } from "@tanstack/react-query";
import { invokeWorkspace } from "../../../platform/tauri/fs";
import type { QuickGitRequest } from "./quickGitPopup";

export const quickComposerKeys = { gitPopup: ["quickComposer", "gitPopup"] as const };
export const quickGitPopupQuery = () => queryOptions({
  queryKey: quickComposerKeys.gitPopup,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return invokeWorkspace<QuickGitRequest | null>("quick_git_state");
  },
  staleTime: Infinity,
  gcTime: 0,
});
