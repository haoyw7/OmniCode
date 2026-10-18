import { createAttachmentThumbnail } from "../features/sessions/model/attachmentThumbnails";
import type { Attachment } from "../features/sessions/model/session";

export const MOBILE_ATTACHMENT_LIMIT = 20;
export const MOBILE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Restore image previews before taking a queued message back to the composer. */
export async function readQueuedAttachmentPreviews(
  attachments: Attachment[],
  read: (
    id: string,
    offset: number,
  ) => Promise<{ data: string; offset: number; size: number }>,
): Promise<Attachment[]> {
  if (
    attachments.length > MOBILE_ATTACHMENT_LIMIT ||
    attachments.some((file) => file.size > MOBILE_ATTACHMENT_BYTES)
  )
    throw new Error("Each attachment must be readable and 20 MB or smaller.");
  const restored: Attachment[] = [];
  for (const file of attachments) {
    if (file.kind !== "image" || file.data !== undefined) {
      restored.push({ ...file });
      continue;
    }
    let offset = 0;
    const chunks: string[] = [];
    while (offset < file.size) {
      const chunk = await read(file.id, offset);
      if (
        chunk.size !== file.size ||
        chunk.offset <= offset ||
        chunk.offset > file.size ||
        atob(chunk.data).length !== chunk.offset - offset ||
        (chunk.offset < file.size && (chunk.offset - offset) % 3 !== 0)
      )
        throw new Error("Invalid image transfer");
      chunks.push(chunk.data);
      offset = chunk.offset;
    }
    restored.push({ ...file, data: chunks.join("") });
  }
  return restored;
}

export async function readMobileAttachments(
  files: File[],
  existing = 0,
): Promise<Attachment[]> {
  if (files.length + existing > MOBILE_ATTACHMENT_LIMIT)
    throw new Error("Attach up to 20 files per message.");
  for (const file of files) {
    if (file.size > MOBILE_ATTACHMENT_BYTES)
      throw new Error("Each attachment must be 20 MB or smaller.");
    if (!file.name.trim() || file.name.length > 255)
      throw new Error("Invalid attachment name.");
  }
  const output: Attachment[] = [];
  for (const file of files) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      // Slicing shares the encoded photo instead of copying it like split().
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () =>
        reject(new Error("Unable to read the selected file."));
      reader.onabort = () =>
        reject(new Error("Unable to read the selected file."));
      reader.readAsDataURL(file);
    });
    const mimeType = file.type || "application/octet-stream";
    const id = crypto.randomUUID();
    // The chip mounts with a small thumbnail instead of decoding the full photo.
    if (mimeType.startsWith("image/")) await createAttachmentThumbnail(id, file);
    output.push({
      id,
      name: file.name,
      size: file.size,
      mimeType,
      kind: mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "file",
      data,
    });
  }
  return output;
}
