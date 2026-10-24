import type { Attachment } from "../../../contracts/session";

export function attachmentPreviewSrc(file: Attachment): string | undefined {
  if (file.previewUrl) return file.previewUrl;
  if (file.data && file.kind === "image") {
    return `data:${file.mimeType};base64,${file.data}`;
  }
  return undefined;
}
