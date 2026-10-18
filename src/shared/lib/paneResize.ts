/**
 * Split dividers resize panes on pointer events; panel folds resize on animation frames.
 * Decorative surfaces can wait for motion to end. Interactive content such
 * as terminal grids follows the live dimensions instead.
 */
let active = 0;
const settledListeners = new Set<() => void>();

export function isPaneResizing(): boolean {
  return active > 0;
}

/** Returns the matching end call; calling it more than once is harmless. */
export function beginPaneResize(): () => void {
  active += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active -= 1;
    if (active > 0) return;
    for (const listener of [...settledListeners]) listener();
  };
}

/** Runs after the last active pane resize ends. */
export function onPaneResizeSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}
