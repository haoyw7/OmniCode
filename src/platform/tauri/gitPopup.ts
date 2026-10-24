import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type NativeGitPopupKind = "workspace" | "base" | "branch";
export type NativeGitPopupRequest<Choice, Branches> = {
  id: string;
  kind: NativeGitPopupKind;
  choice: Choice;
  branches?: Branches;
  anchor: { x: number; y: number; width: number; height: number };
};
export type NativeGitPopupResult<Choice> = {
  id: string;
  choice?: Choice;
  restoreFocus: boolean;
  triggerKind?: NativeGitPopupKind | null;
};

/** The auxiliary window transports selection data; it never executes Git. */
export function openNativeGitPopup<Choice, Branches>(request: NativeGitPopupRequest<Choice, Branches>): Promise<void> {
  return invoke("quick_git_open", { request });
}

export function readNativeGitPopup<Choice, Branches>(): Promise<NativeGitPopupRequest<Choice, Branches> | null> {
  return invoke("quick_git_state");
}

export function finishNativeGitPopup<Choice>(result: { id: string; choice: Choice | null; restoreFocus: boolean }): Promise<void> {
  return invoke("quick_git_complete", result);
}

export function fitNativeGitPopup(id: string, height: number): Promise<void> {
  return invoke("quick_git_fit", { id, height });
}

export function subscribeNativeGitPopup<Choice, Branches>(handler: (event: { payload: NativeGitPopupRequest<Choice, Branches> }) => void): Promise<() => void> {
  return listen("quick_git_request", handler);
}

export function subscribeNativeGitPopupResult<Choice>(handler: (event: { payload: NativeGitPopupResult<Choice> }) => void): Promise<() => void> {
  return listen("quick_git_result", handler);
}
