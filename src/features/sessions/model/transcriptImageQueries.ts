import { queryOptions } from "@tanstack/react-query";

type ReadImage = (path: string) => Promise<Uint8Array<ArrayBuffer>>;
const sources = new WeakMap<object, number>();
let sourceId = 0;

export function transcriptImageQuery(path: string, read: ReadImage) {
  if (!sources.has(read)) sources.set(read, ++sourceId);
  return queryOptions({
    queryKey: ["transcript", "image", sources.get(read), path],
    queryFn: ({ signal }) => { signal.throwIfAborted(); return read(path); },
    gcTime: 0,
    staleTime: Infinity,
    structuralSharing: false,
  });
}

export function noteImageQuery(asset: string, resolve: (asset: string) => Promise<string>) {
  if (!sources.has(resolve)) sources.set(resolve, ++sourceId);
  return queryOptions({
    queryKey: ["transcript", "noteImage", sources.get(resolve), asset],
    queryFn: ({ signal }) => { signal.throwIfAborted(); return resolve(asset); },
    staleTime: Infinity,
    gcTime: 0,
  });
}
