import { readAttachmentBase64 } from "../../../platform/tauri/attachmentFiles";
import type { Attachment } from "../../../contracts/session";
import type { RemoteAttachment } from "../../../contracts/protocol";
import { remoteRequest } from "./connections";

const MAX_BYTES = 20 * 1024 * 1024;
// Keep each request well below the host's 4 MiB JSON limit.
const CHUNK_CHARS = 4 * Math.floor((512 * 1024) / 3);

export async function readRemoteQueuedAttachments(
  machineId: string,
  sessionId: string,
  attachments: Attachment[],
): Promise<Attachment[]> {
  if (attachments.length > 20 || attachments.some((file) => file.size > MAX_BYTES))
    throw new Error("Each attachment must be readable and 20 MB or smaller.");
  return Promise.all(attachments.map(async (file) => {
    if (file.data !== undefined) return { ...file };
    let offset = 0;
    const chunks: string[] = [];
    while (offset < file.size) {
      const chunk = await remoteRequest<{ data: string; offset: number; size: number }>(
        machineId, "attachments.read", { sessionId, id: file.id, offset },
      );
      if (chunk.size !== file.size || chunk.offset <= offset || chunk.offset > file.size ||
          atob(chunk.data).length !== chunk.offset - offset ||
          (chunk.offset < file.size && (chunk.offset - offset) % 3 !== 0))
        throw new Error("Invalid attachment transfer");
      chunks.push(chunk.data);
      offset = chunk.offset;
    }
    return { ...file, data: chunks.join("") };
  }));
}

export async function uploadRemoteAttachments(
  machineId: string,
  attachments: Attachment[],
): Promise<RemoteAttachment[]> {
  if (attachments.length > 20) throw new Error("Too many attachments");
  const uploaded: RemoteAttachment[] = [];
  for (const file of attachments) {
    if (file.size > MAX_BYTES)
      throw new Error(
        `${file.name} is too large to send to a remote machine (20 MB maximum)`,
      );
    const data =
      file.data ??
      (file.path
        ? await readAttachmentBase64(file.path)
        : undefined);
    if (data === undefined)
      throw new Error(`Cannot read ${file.name} for remote upload`);
    let offset = 0;
    if (data.length === 0) {
      await remoteRequest(machineId, "attachments.upload", {
        id: file.id,
        offset: 0,
        size: file.size,
        data: "",
      });
    }
    for (let index = 0; index < data.length; index += CHUNK_CHARS) {
      const chunk = data.slice(index, index + CHUNK_CHARS);
      const reply = await remoteRequest<{ offset: number }>(
        machineId,
        "attachments.upload",
        {
          id: file.id,
          offset,
          size: file.size,
          data: chunk,
        },
      );
      offset = reply.offset;
    }
    if (offset !== file.size)
      throw new Error(`Could not finish uploading ${file.name}`);
    uploaded.push({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      size: file.size,
    });
  }
  return uploaded;
}
