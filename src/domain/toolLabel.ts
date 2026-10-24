import type { Block } from "../contracts/session";
import { composeToolTitle } from "./preview";
import { displayPath } from "./pathDisplay";
export function toolCallLabel(block: Block, cwd?: string): string {
  const preview = block.tool?.preview;
  const path = preview?.path
    ? displayPath(preview.path, cwd)
    : preview?.fileName;
  return (
    composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd,
    }) || "Working"
  );
}
