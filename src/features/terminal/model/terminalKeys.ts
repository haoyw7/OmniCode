type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export function terminalClipboardShortcut(
  event: TerminalKeyEvent & Pick<KeyboardEvent, "isComposing" | "keyCode">,
  isMac: boolean,
  hasSelection: boolean,
): "copy" | "paste" | null {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (!event.metaKey && key === "insert") {
    if (event.ctrlKey && !event.shiftKey) return "copy";
    if (event.shiftKey && !event.ctrlKey) return "paste";
  }
  const modifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  if (key === "v") return "paste";
  if (key === "c" && (isMac || event.shiftKey || hasSelection)) return "copy";
  return null;
}

/** Translate macOS editing shortcuts into sequences understood by common shells. */
export function macTerminalShortcutData(
  event: TerminalKeyEvent,
): string | null {
  if (event.ctrlKey || event.shiftKey) return null;

  if (event.altKey && !event.metaKey) {
    if (event.key === "ArrowLeft") return "\x1bb";
    if (event.key === "ArrowRight") return "\x1bf";
    return null;
  }

  if (event.metaKey && !event.altKey) {
    if (event.key === "ArrowLeft") return "\x01";
    if (event.key === "ArrowRight") return "\x05";
    if (event.key === "Backspace") return "\x15";
  }

  return null;
}

/**
 * Whether a key press is the macOS Cmd+K clear. It only reaches the terminal
 * when "App: Search" is disabled or rebound, since the app claims it first.
 */
export function isMacTerminalClearShortcut(event: TerminalKeyEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}
