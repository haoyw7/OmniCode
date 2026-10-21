import { queryOptions } from "@tanstack/react-query";

// Inject the platform reader to keep the filesystem watcher dependency one-way.
export const directoryKeys = {
  all: ["files", "directory"] as const,
  path: (path: string) => ["files", "directory", path] as const,
};
export const directoryQuery = <T>(path: string, read: (path: string) => Promise<T>) => queryOptions({
  queryKey: directoryKeys.path(path),
  queryFn: ({ signal }) => { signal.throwIfAborted(); return read(path); },
  staleTime: Infinity,
});
