/**
 * WebKitGTK with an IME can emit keydown(229), input, compositionend for a
 * direct commit, without compositionstart. xterm already sends that input via
 * its keydown textarea-diff handler. Finalizing a nonexistent composition also
 * replays stale textarea content, duplicating this and previous keystrokes.
 */
export function guardTerminalComposition(
  textarea: HTMLTextAreaElement | undefined,
): () => void {
  if (!textarea) return () => {};
  let composing = false;
  let pendingDirectInput = false;
  const onKeyDown = (event: KeyboardEvent) => {
    pendingDirectInput = !composing && event.keyCode === 229;
  };
  const onKeyUp = () => {
    pendingDirectInput = false;
  };
  const onStart = () => {
    composing = true;
    pendingDirectInput = false;
  };
  const onEnd = (event: CompositionEvent) => {
    // Only suppress a commit already owned by xterm's keydown(229) handler.
    // Commit-only events from other input methods still belong to xterm.
    if (!composing && pendingDirectInput) event.stopImmediatePropagation();
    composing = false;
    pendingDirectInput = false;
  };
  // Capture runs before xterm's composition listeners, even though xterm
  // installed them when opening the terminal. Leave input/keydown untouched.
  textarea.addEventListener("keydown", onKeyDown, true);
  textarea.addEventListener("keyup", onKeyUp, true);
  textarea.addEventListener("compositionstart", onStart, true);
  textarea.addEventListener("compositionend", onEnd, true);
  return () => {
    textarea.removeEventListener("keydown", onKeyDown, true);
    textarea.removeEventListener("keyup", onKeyUp, true);
    textarea.removeEventListener("compositionstart", onStart, true);
    textarea.removeEventListener("compositionend", onEnd, true);
  };
}
