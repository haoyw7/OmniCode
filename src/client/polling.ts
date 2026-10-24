import type { LifecyclePort } from "./ports";

export const SESSION_WAIT_MS = 1_000;

/** Both clients use one scheduler for visible transcript reads. A running
 * request may finish after suspension, but suspension never schedules another. */
export function startHostPolling(options: {
  poll(waitMs?: number): Promise<boolean | void>;
  supportsWait(): boolean;
  onError(error: unknown): void;
  lifecycle?: LifecyclePort;
}): () => void {
  let disposed = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !disposed && (options.lifecycle?.isActive() ?? true);
  const schedule = (delay: number) => {
    if (timer !== undefined) clearTimeout(timer);
    if (active()) timer = setTimeout(() => { timer = undefined; void poll(); }, delay);
  };
  const poll = async () => {
    if (!active() || running) return;
    running = true;
    const wait = options.supportsWait();
    let busy = false;
    try {
      busy = !!await options.poll(wait ? SESSION_WAIT_MS : undefined);
      failures = 0;
    } catch (error) {
      failures++;
      if (active()) options.onError(error);
    } finally {
      running = false;
      schedule(failures ? Math.min(30_000, 750 * 2 ** Math.min(failures, 6))
        : wait ? 50 : busy ? 250 : 3_000);
    }
  };
  const unsubscribe = options.lifecycle?.subscribe((foreground) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (foreground) void poll();
  });
  void poll();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
  };
}
