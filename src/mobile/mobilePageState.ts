import { createContext, useCallback, useContext, useState, type SetStateAction } from "react";

export interface MobilePageState {
  scroll: Map<string, number>;
  values: Map<string, unknown>;
}

export const MobilePageStateContext = createContext<MobilePageState | undefined>(undefined);

/** Small view state survives a return without retaining the page's DOM. */
export function useMobilePageState<T>(key: string | undefined, initial: T) {
  const page = useContext(MobilePageStateContext);
  const [value, setValue] = useState<T>(() =>
    key && page?.values.has(key) ? page.values.get(key) as T : initial,
  );
  const update = useCallback((next: SetStateAction<T>) => {
    setValue((previous) => {
      const resolved = typeof next === "function"
        ? (next as (value: T) => T)(previous) : next;
      if (key) page?.values.set(key, resolved);
      return resolved;
    });
  }, [key, page]);
  return [value, update] as const;
}
