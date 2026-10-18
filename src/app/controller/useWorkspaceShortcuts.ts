import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { handleEditorFindKey } from "../../features/connections/files/editor/editorSearch";
import { NOTIFICATION_CLICK_EVENT } from "../../features/notifications/model/notifications";
import { type Session } from "../../features/sessions/model/session";
import { resolveAppShortcut } from "../../features/settings/model/appShortcuts";
import {
  keybindingPressed,
  loadAutosave,
  loadKeybindingOverrides,
  matchCustomKeybinding,
  saveAutosave,
  subscribeAutosave,
  subscribeKeybindings,
  type SettingsSectionId,
} from "../../features/settings/model/settings";
import { resolveZoomKeybinding } from "../../features/settings/model/zoomKeybinding";
import {
  shouldHandleListNavigation,
  tabCommand,
  tabCommandForKeybinding,
  tabCommandKeybinding,
} from "../../features/workspace/model/tabKeys";
import { IS_MAC } from "../../platform/tauri/platform";
import type { CommandDispatch } from "../commands/useCommandDispatcher";
import { TRAY_OPEN_SESSION_EVENT } from "../model/traySessions";

type Options = {
  onArchiveFocusedSession: (event: KeyboardEvent) => void;
  openSettings: (
    section?: SettingsSectionId | undefined,
    anchor?: string | undefined,
  ) => void;
  onOpenApprovalSession: (sessionId: string) => void;
  onSelectRemoteSession: (project: string, remoteSessionId: string) => void;
  dispatch: CommandDispatch;
  appViewFocusedRef: RefObject<
    | "settings"
    | "search"
    | "inbox"
    | "notes"
    | "automations"
    | "workflows"
    | "assistant"
    | "projects"
    | undefined
  >;
  paletteOpenRef: RefObject<boolean>;
  whatsNewVersionRef: RefObject<string | null>;
  sessionsRef: RefObject<Session[]>;
};

export function useWorkspaceShortcuts({
  onArchiveFocusedSession,
  openSettings,
  onOpenApprovalSession,
  onSelectRemoteSession,
  dispatch,
  appViewFocusedRef,
  paletteOpenRef,
  whatsNewVersionRef,
  sessionsRef,
}: Options) {
  const actions = useRef({
    onArchiveFocusedSession,
    openSettings,
    onOpenApprovalSession,
    onSelectRemoteSession,
  });

  actions.current = {
    onArchiveFocusedSession,
    openSettings,
    onOpenApprovalSession,
    onSelectRemoteSession,
  };

  useEffect(() => {
    if (!IS_MAC) return;
    const applyAutosave = () => {
      void invoke("autosave_set_enabled", { enabled: loadAutosave() }).catch(
        console.error,
      );
    };
    const applyKeybindings = () => {
      void invoke("keybindings_set_overrides", {
        overrides: loadKeybindingOverrides(),
      }).catch(console.error);
    };
    applyAutosave();
    applyKeybindings();
    const stopAutosave = subscribeAutosave(applyAutosave);
    const stopKeybindings = subscribeKeybindings(applyKeybindings);
    return () => {
      stopAutosave();
      stopKeybindings();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Quick Composer recorder owns the next key combination, including
      // bindings that the workspace would normally handle in capture phase.
      if (document.querySelector('[data-shortcut-recorder-active="true"]'))
        return;
      // Never act on a chord while an IME is composing: tabCommand and the
      // editor guards already do, and the app shortcut resolver does too, so
      // this keeps the whole handler consistent for whatever is added next.
      if (e.isComposing) return;
      const customCommand = matchCustomKeybinding(e);
      const pressed = (command: string, defaultMatch: boolean) =>
        keybindingPressed(command, e, defaultMatch);
      // A rebound zoom chord may be Option-only, so it is resolved outside the
      // Cmd/Ctrl guard that only the browser-standard defaults need.
      const zoomAction = resolveZoomKeybinding(e);
      if (zoomAction) {
        e.preventDefault();
        e.stopPropagation();
        dispatch(
          zoomAction === "zoom-in"
            ? "View: Zoom In"
            : zoomAction === "zoom-out"
              ? "View: Zoom Out"
              : "View: Reset Zoom",
        );
        return;
      }
      const cmd = customCommand
        ? tabCommandForKeybinding(customCommand, e)
        : tabCommand(e);
      if (cmd && pressed(tabCommandKeybinding(cmd), !customCommand)) {
        if (cmd === "archive-session") {
          if (e.repeat) return;
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-session-in-tab" ||
          cmd === "next-session-in-tab" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .monocode-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            Boolean(appViewFocusedRef.current) ||
            paletteOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".monocode-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" ||
            cmd === "forward" ||
            /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if (
          (cmd === "split-right" || cmd === "split-down") &&
          target?.closest(".cm-editor")
        ) {
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        dispatch(
          tabCommandKeybinding(cmd),
          typeof cmd === "object" && "activate" in cmd
            ? cmd.activate
            : undefined,
        );
        return;
      }
      if (
        !appViewFocusedRef.current &&
        !(
          e.target instanceof Element &&
          e.target.closest("[data-session-drop], [data-agent-tab]")
        ) &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const shortcut = resolveAppShortcut(e);
      if (shortcut) {
        if (
          shortcut === "App: Search" &&
          e.target instanceof Element &&
          e.target.closest(".monocode-terminal") &&
          e.ctrlKey &&
          !e.metaKey
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        dispatch(shortcut);
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch]);

  useEffect(() => {
    // Commands with a native menu event are subscribed by useCommandDispatcher;
    // these carry a payload or open a specific place.
    const unlisten: Array<Promise<() => void>> = [
      listen<boolean>("toggle_autosave", ({ payload }) => {
        const saved = saveAutosave(payload);
        if (saved !== payload && IS_MAC) {
          void invoke("autosave_set_enabled", { enabled: saved });
        }
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      // Rust sends this to one window, already shown.
      listen<{ id: string; project: string }>(
        TRAY_OPEN_SESSION_EVENT,
        ({ payload }) => {
          const win = getCurrentWindow();
          void win
            .unminimize()
            .then(() => win.setFocus())
            .catch(() => {});
          actions.current.onSelectRemoteSession(payload.project, payload.id);
        },
      ),
      // Every window hears the click; only the one holding the session acts.
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
        if (!sessionsRef.current.some((s) => s.id === sessionId)) return;
        const win = getCurrentWindow();
        // Windows leaves a minimized window minimized when it is only focused.
        void win
          .unminimize()
          .then(() => win.setFocus())
          .catch(() => {});
        actions.current.onOpenApprovalSession(sessionId);
      }),
    ];
    return () => {
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);
}
