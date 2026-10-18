/** Coalesce fitting outside ResizeObserver delivery, without delaying the divider. */
export function createTerminalFitScheduler(fit: () => void, target: Window = window) {
  let cancelPending: (() => void) | undefined;
  let disposed = false;
  const cancel = () => {
    cancelPending?.();
    cancelPending = undefined;
  };
  return {
    schedule() {
      if (disposed || cancelPending) return;
      const run = () => {
        cancel();
        if (!disposed) fit();
      };
      const Channel = (target as Window & typeof globalThis).MessageChannel;
      if (typeof Channel === "function") {
        const channel = new Channel();
        channel.port1.onmessage = run;
        cancelPending = () => {
          channel.port1.onmessage = null;
          channel.port1.close();
          channel.port2.close();
        };
        channel.port2.postMessage(null);
      } else {
        const timer = target.setTimeout(run, 0);
        cancelPending = () => target.clearTimeout(timer);
      }
    },
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
