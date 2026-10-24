import { invokeWorkspace, workspacePathOwner } from "./fs";
import type { AttachmentPathInfo, BinaryTransfer, BinaryTransferChunk } from "../../contracts/hostMedia";

/** Resolve each source independently: a picked local file is never sent to a remote project's Host. */
export async function inspectAttachmentPaths(paths: string[]): Promise<AttachmentPathInfo[]> {
  if (new Set(paths.map(path => workspacePathOwner("inspect_paths", path))).size <= 1)
    return invokeWorkspace<AttachmentPathInfo[]>("inspect_paths", { paths });
  const groups = await Promise.all(paths.map(path => invokeWorkspace<AttachmentPathInfo[]>("inspect_paths", { paths: [path] })));
  return groups.flat();
}

/** Project paths use Host snapshots; system-picked non-project files retain native reading. */
export async function readAttachmentBase64(path: string): Promise<string> {
  const result = await invokeWorkspace<string | BinaryTransfer>("read_file_base64", { path });
  if (typeof result === "string") return result;
  if (!result || typeof result.transfer !== "string" || !Number.isSafeInteger(result.size) || result.size < 0 || result.size > 20 * 1024 * 1024)
    throw new Error("Invalid attachment transfer");
  const parts: string[] = [];
  let offset = 0;
  while (offset < result.size) {
    const chunk = await invokeWorkspace<BinaryTransferChunk>("read_attachment_chunk", { path, transfer: result.transfer, offset });
    if (chunk.size !== result.size || chunk.offset <= offset || chunk.offset > result.size ||
      atob(chunk.data).length !== chunk.offset - offset || (chunk.offset < result.size && (chunk.offset - offset) % 3 !== 0))
      throw new Error("Invalid attachment transfer");
    parts.push(chunk.data);
    offset = chunk.offset;
  }
  return parts.join("");
}
