import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { QuickOpenMode } from "./quickOpen";

export function useQuickOpenMode(initial: QuickOpenMode = "files") {
  return useQueryState("quickOpen", parseAsStringLiteral(["files", "commands", "sessions", "projects"]).withDefault(initial).withOptions({ clearOnDefault: false }));
}
