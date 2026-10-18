import { usePreferenceState } from "../../model/usePreferenceState";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { RotateCcw, Search } from "../../../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { IS_MAC } from "../../../../platform/tauri/platform";
import {
  filterKeybindings,
  currentKeybindings,
  loadKeybindingOverrides,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveKeybindingOverride,
  validateKeybindingShortcut,
  saveQuickComposerEnabled,
  saveQuickComposerShortcut,
  subscribeKeybindings,
  type KeybindingOverride,
} from "../../model/settings";
import { setQuickComposerShortcut } from "../../../quick-composer/model/quickComposer";
import {
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  quickComposerShortcutPreview,
  shortcutFromKeyEvent,
} from "../../../quick-composer/model/quickComposerShortcut";
import { Group } from "../settingsLayout";



type ShortcutModifier = "metaKey" | "ctrlKey" | "altKey" | "shiftKey";

function shortcutModifier(event: KeyboardEvent): ShortcutModifier | null {
  if (event.key === "Meta" || event.code.startsWith("Meta")) return "metaKey";
  if (event.key === "Control" || event.code.startsWith("Control"))
    return "ctrlKey";
  if (event.key === "Alt" || event.code.startsWith("Alt")) return "altKey";
  if (event.key === "Shift" || event.code.startsWith("Shift"))
    return "shiftKey";
  return null;
}

function ShortcutEditor({
  name,
  display,
  resetVisible,
  onApply,
  onDisable,
  onReset,
}: {
  name: string;
  display: string | null;
  resetVisible: boolean;
  onApply: (shortcut: string) => void | Promise<void>;
  onDisable: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const held = useRef({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });

  const run = async (action: () => void | Promise<void>) => {
    setRecording(false);
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const beginRecording = () => {
    held.current = {
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    setPreview("");
    setError(null);
    setRecording(true);
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const bare =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      // An unmodified Tab leaves the recorder instead of trapping focus.
      if (bare && event.code === "Tab") {
        setRecording(false);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        setRecording(false);
        setError(null);
        return;
      }
      // Delete disables, but only on its own so Cmd+Delete still records.
      if (bare && (event.code === "Backspace" || event.code === "Delete")) {
        void run(onDisable);
        return;
      }
      const modifier = shortcutModifier(event);
      if (modifier) held.current[modifier] = true;
      const modifiers = {
        metaKey: event.metaKey || held.current.metaKey,
        ctrlKey: event.ctrlKey || held.current.ctrlKey,
        altKey: event.altKey || held.current.altKey,
        shiftKey: event.shiftKey || held.current.shiftKey,
      };
      setPreview(
        quickComposerShortcutPreview(
          modifiers,
          modifier ? undefined : event.code,
          event.key,
        ),
      );
      if (modifier) return;
      const next = shortcutFromKeyEvent({ ...modifiers, code: event.code });
      if (next) void run(() => onApply(next));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const modifier = shortcutModifier(event);
      if (!modifier) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      held.current[modifier] = false;
      const modifiers = {
        metaKey: event.metaKey || held.current.metaKey,
        ctrlKey: event.ctrlKey || held.current.ctrlKey,
        altKey: event.altKey || held.current.altKey,
        shiftKey: event.shiftKey || held.current.shiftKey,
      };
      modifiers[modifier] = false;
      setPreview(quickComposerShortcutPreview(modifiers));
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [onApply, onDisable, recording]);

  return (
    <div className="relative w-40 shrink-0">
      <div className="flex items-center gap-0.5">
        <input data-ui="input"
          type="text"
          readOnly
          aria-label={uiT("Change {value0} shortcut", { value0: String(name) })}
          data-shortcut-recorder-active={recording ? "true" : undefined}
          aria-busy={busy || undefined}
          value={
            recording || busy ? preview || "Record…" : (display ?? "Disabled")
          }
          onFocus={beginRecording}
          onClick={beginRecording}
          onBlur={() => setRecording(false)}
          className={`h-6 w-28 shrink-0 truncate rounded-md border bg-transparent px-1.5 py-0 font-mono text-[11px] leading-none outline-none focus:border-accent ${
            busy ? "opacity-50" : ""
          } ${
            display === null
              ? "border-dashed border-content/15 text-content/35"
              : "border-content/15 text-content/80 hover:bg-content/6"
          }`}
        />
        {resetVisible ? (
          <button
            type="button"
            aria-label={uiT("Reset {value0} shortcut", {
              value0: String(name),
            })}
            disabled={busy}
            onClick={() => void run(onReset)}
            className="rounded-md px-1 py-1 text-content/35 hover:bg-content/6 hover:text-content disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}
      </div>
      {recording ? (
        <p
          className="pointer-events-none absolute top-1/2 right-full z-40 mr-3 -translate-y-1/2 text-[10px] whitespace-nowrap text-content/50"
          aria-live="polite"
        >
          {uiT("Del disables · Esc cancels")}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="absolute top-full left-0 z-40 mt-1.5 w-max max-w-64 rounded-md border border-content/10 bg-background-base/95 px-2 py-1 text-[11px] whitespace-nowrap text-red-400 shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function QuickComposerShortcutEditor() {
  const [shortcut, setShortcut] = usePreferenceState(loadQuickComposerShortcut);
  const [enabled, setEnabled] = usePreferenceState(loadQuickComposerEnabled);
  const apply = async (next: string) => {
    if (!isGlobalShortcut(next))
      throw new Error("Quick Composer needs ⌘ or Ctrl as a global hotkey");
    // Validate before the native call: a rejected chord must not leave the OS
    // holding a registered global hotkey that settings does not know about.
    validateKeybindingShortcut("App: Quick Composer", next);
    // Recording while the feature is off must not silently switch it back on.
    if (enabled) await setQuickComposerShortcut(true, next);
    saveQuickComposerShortcut(next);
    setShortcut(next);
  };
  const reset = async () => {
    // Reset restores the whole default state, including the enabled flag.
    validateKeybindingShortcut(
      "App: Quick Composer",
      QUICK_COMPOSER_DEFAULT_SHORTCUT,
    );
    await setQuickComposerShortcut(true, QUICK_COMPOSER_DEFAULT_SHORTCUT);
    saveQuickComposerEnabled(true);
    saveQuickComposerShortcut(QUICK_COMPOSER_DEFAULT_SHORTCUT);
    setShortcut(QUICK_COMPOSER_DEFAULT_SHORTCUT);
    setEnabled(true);
  };
  return (
    <ShortcutEditor
      name="quick composer"
      display={enabled ? quickComposerShortcutLabel(shortcut) : null}
      resetVisible={
        enabled !== true || shortcut !== QUICK_COMPOSER_DEFAULT_SHORTCUT
      }
      onApply={apply}
      onDisable={async () => {
        await setQuickComposerShortcut(false);
        saveQuickComposerEnabled(false);
        setEnabled(false);
      }}
      onReset={reset}
    />
  );
}

function KeybindingShortcutEditor({
  command,
  display,
  modified,
  onSave,
}: {
  command: string;
  display: string | null;
  modified: boolean;
  onSave: (
    command: string,
    override: KeybindingOverride,
  ) => void | Promise<void>;
}) {
  const { t: uiT } = useTranslation();
  return (
    <ShortcutEditor
      name={uiT(command)}
      display={display}
      resetVisible={modified}
      onApply={(shortcut) => onSave(command, { shortcut })}
      onDisable={() => onSave(command, { disabled: true })}
      onReset={() => onSave(command, {})}
    />
  );
}

export function KeybindingsPage() {
  const { t: uiT } = useTranslation();
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = usePreferenceState(loadKeybindingOverrides);
  useEffect(
    () => subscribeKeybindings(() => setOverrides(loadKeybindingOverrides())),
    [],
  );
  const rows = useMemo(
    () => filterKeybindings(currentKeybindings(), query),
    [query, overrides],
  );

  const save = async (command: string, override: KeybindingOverride) => {
    const next = saveKeybindingOverride(command, override);
    if (IS_MAC) await invoke("keybindings_set_overrides", { overrides: next });
  };

  return (
    <Group
      title={uiT("Shortcuts")}
      description={uiT(
        "Click a shortcut to record new keys. Press Delete while recording to disable it.",
      )}
      action={
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
            {rows.length} {rows.length === 1 ? uiT("binding") : uiT("bindings")}
          </span>
          <label className="flex h-7 w-44 shrink-0 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45 focus-within:border-content/20">
            <Search className="size-3.5 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiT("Filter")}
              aria-label={uiT("Filter keybindings")}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
            />
          </label>
        </div>
      }
    >
      <div className="flex items-center border-b border-stroke bg-content/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content/40">
        <span className="min-w-0 flex-1">{uiT("Command")}</span>
        <span className="w-40 shrink-0">{uiT("Keybinding")}</span>
        <span className="w-28 shrink-0">{uiT("When")}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-content/45">
          {uiT("No matching bindings")}
        </p>
      ) : (
        rows.map((row) => {
          const override = overrides[row.command];
          const disabled = override?.disabled === true;
          return (
            <div
              key={uiT(row.command)}
              className="flex h-11 items-center border-b border-content/5 px-4 text-[12px] last:border-b-0"
            >
              <span
                className={`min-w-0 flex-1 truncate ${disabled ? "text-content/45" : ""}`}
              >
                {uiT(row.command)}
              </span>
              {row.command === "App: Quick Composer" ? (
                <QuickComposerShortcutEditor />
              ) : (
                <KeybindingShortcutEditor
                  command={row.command}
                  display={disabled ? null : row.keys}
                  modified={Boolean(override)}
                  onSave={save}
                />
              )}
              <span className="w-28 shrink-0 font-mono text-[11px] text-content/40">
                {uiT(row.when)}
              </span>
            </div>
          );
        })
      )}
    </Group>
  );
}
