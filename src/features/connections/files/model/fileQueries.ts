import { queryOptions } from "@tanstack/react-query";
import { readBinaryFile } from "../../../../platform/tauri/fs";

export const binaryFileQuery = (path: string) => queryOptions({
  queryKey: ["files", "binary", path],
  queryFn: () => readBinaryFile(path),
  // Large byte arrays belong to mounted viewers only; blob URLs stay local.
  gcTime: 0,
  structuralSharing: false,
});
