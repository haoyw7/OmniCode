import type { Terminal } from "@xterm/xterm";
import { Scrollbar } from "../../../shared/ui/Scrollbar";

/** Keep the rail on the persistent renderer, including when a pane is reparented. */
export function attachTerminalScrollbar(term: Terminal, renderer: HTMLElement) {
  const scrollbar = new Scrollbar(
    renderer,
    () => ({
      offset: term.buffer.active.viewportY,
      content:
        term.buffer.active.type === "alternate"
          ? term.rows
          : term.buffer.active.baseY + term.rows,
      viewport: term.rows,
    }),
    (offset) => term.scrollToLine(Math.round(offset)),
    () => 1,
  );
  const subscriptions = [
    term.onScroll(scrollbar.update),
    term.onRender(scrollbar.update),
    term.onResize(scrollbar.update),
    term.buffer.onBufferChange(scrollbar.update),
  ];
  return () => {
    for (const subscription of subscriptions) subscription.dispose();
    scrollbar.destroy();
  };
}
