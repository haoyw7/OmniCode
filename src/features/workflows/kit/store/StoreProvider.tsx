// Monocode shim: ZCode's app store selector with a default.
export function useZCodeStoreWithDefault<T>(_selector: (state: { theme: "light" | "dark" | "system" }) => T, fallback: T): T {
  return fallback;
}
