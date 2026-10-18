import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import {
  APP_COMMANDS,
  createCommandDebounce,
  type CommandHandlers,
} from "./registry";

export type CommandDispatch = (id: string, arg?: unknown) => boolean;

/**
 * Runs app commands by id from the latest handlers, debounced per command so a
 * native accelerator and the webview key handler cannot both fire it, and
 * subscribes every command that has a native menu event.
 */
export function useCommandDispatcher(handlers: CommandHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const debounce = useRef(createCommandDebounce());

  const dispatch = useCallback<CommandDispatch>((id, arg) => {
    const handler = handlersRef.current[id];
    if (!handler) return false;
    const key = arg === undefined ? id : `${id}:${String(arg)}`;
    if (!debounce.current(key, performance.now())) return true;
    handler(arg);
    return true;
  }, []);

  useEffect(() => {
    const unlisten = APP_COMMANDS.flatMap((spec) =>
      spec.nativeEvent
        ? [listen(spec.nativeEvent, () => void dispatch(spec.id))]
        : [],
    );
    // The unchanged macOS menu still emits this legacy event. Both menu
    // entries now reach the single sidebar command and share its debounce.
    unlisten.push(
      listen(
        "toggle_session_sidebar",
        () => void dispatch("App: Toggle Sidebar"),
      ),
    );
    return () => {
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [dispatch]);

  return dispatch;
}
