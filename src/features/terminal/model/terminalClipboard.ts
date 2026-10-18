import type { Terminal } from "@xterm/xterm";
import { readClipboardText } from "../../../platform/tauri/clipboard";

/** Prefer a native paste event while the user gesture is still active. */
export async function pasteTerminalClipboard(
  term: Pick<Terminal, "focus" | "paste">,
  host: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  term.focus();
  let receivedPaste = false;
  const onPaste = (event: Event) => {
    if (event.target instanceof Node && host.contains(event.target)) receivedPaste = true;
  };
  // Observe before xterm/app paste listeners stop propagation. A handled,
  // cancelled paste event can make execCommand return false despite success.
  host.ownerDocument.addEventListener("paste", onPaste, true);
  try {
    try {
      if (host.ownerDocument.execCommand("paste") || receivedPaste) return;
    } catch {
      if (receivedPaste) return;
    }
  } finally {
    host.ownerDocument.removeEventListener("paste", onPaste, true);
  }
  const text = await readClipboardText();
  // Reading the clipboard can outlive a tab switch or terminal teardown.
  if (isCurrent() && text) term.paste(text);
}
