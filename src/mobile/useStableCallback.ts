import { useCallback, useRef } from "react";

/**
 * A callback whose identity never changes but always calls the latest render's
 * function. Memoized children keep their props equal while the app re-renders
 * on every keystroke; the handlers only run from events, after commit.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Args) => latest.current(...args), []);
}
