import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export function reportQuitState(id: number, inFlight: number): Promise<void> {
  return invoke("quit_poll_reply", { id, inFlight });
}

export function confirmQuitDecision(id: number, confirmed: boolean): Promise<void> {
  return invoke("quit_decision", { id, confirmed });
}

export function reportQuitReady(id: number, persisted: boolean): Promise<void> {
  return invoke("quit_ready", { id, persisted });
}

/** The shell's quit handshake; each step is answered through the calls above. */
export function subscribeQuitHandshake(handlers: {
  poll: (id: number) => void;
  confirm: (id: number, inFlight: number) => void;
  commit: (id: number) => void;
  aborted: () => void;
}): void {
  void listen<number>("quit_poll", (event) => handlers.poll(event.payload));
  // Scoped to this window on purpose: a global `listen` is registered as `Any`,
  // which Tauri matches for every event regardless of the emitter's target, so
  // one dialog would become one per window.
  void getCurrentWebviewWindow().listen<{ id: number; inFlight: number }>(
    "quit_confirm",
    (event) => handlers.confirm(event.payload.id, event.payload.inFlight),
  );
  void listen<number>("quit_commit", (event) => handlers.commit(event.payload));
  void listen("quit_aborted", () => handlers.aborted());
}

export function hideWorkspaceWindow(): Promise<void> {
  return invoke("hide_window");
}

export function destroyWorkspaceWindow(): Promise<void> {
  return invoke("destroy_window");
}

export function openWorkspaceWindow(): Promise<void> {
  return invoke("open_new_window");
}

export function takeWindowTransfer(): Promise<string | null> {
  return invoke("take_window_transfer");
}

/** One-time import source; session execution and authoritative state live in Host. */
export function readLegacyWorkspaceSnapshot(): Promise<unknown> {
  return invoke("workspace_get_snapshot");
}

export function defaultDesktopDirectory(): Promise<string> {
  return invoke("default_cwd");
}

export function setTrafficLightsVisible(visible: boolean): Promise<void> {
  return invoke("set_traffic_lights_visible", { visible });
}

export function setNativeAutosave(enabled: boolean): Promise<void> {
  return invoke("autosave_set_enabled", { enabled });
}

export function setNativeKeybindings(overrides: Record<string, { disabled?: boolean; shortcut?: string }>): Promise<void> {
  return invoke("keybindings_set_overrides", { overrides });
}

export function subscribeNativeMenuCommand(command: string, handler: () => void): Promise<() => void> {
  return listen(command, handler);
}

export function subscribeNativeAutosave(handler: (event: { payload: boolean }) => void): Promise<() => void> {
  return listen("toggle_autosave", handler);
}

export function subscribeTrayConversation(handler: (event: { payload: { id: string; project: string } }) => void): Promise<() => void> {
  return listen("omnicode:tray-open-session", handler);
}

export function subscribeNotificationClick(handler: (event: { payload: string }) => void): Promise<() => void> {
  return listen("omnicode:notification-click", handler);
}

/** App-owned notices every open window applies to its own stores. */
export function broadcastWindowEvent(name: string, payload: unknown): Promise<void> {
  return emit(name, payload);
}

export function subscribeWindowEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  return listen<T>(name, (event) => handler(event.payload));
}
