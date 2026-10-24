export const HOST_INBOX_MEDIA_CAPABILITY = "media.inbox.v1";
export const HOST_LINK_PREVIEW_CAPABILITY = "links.preview.v1";
export const HOST_ATTACHMENT_READ_CAPABILITY = "workspace.attachments.v1";

export type BinaryTransfer = { transfer: string; size: number };
export type BinaryTransferChunk = { data: string; offset: number; size: number };
export type LinkPreviewMetadata = { title: string | null; faviconDataUrl: string | null };
export type AttachmentPathInfo = { path: string; name: string; size: number; isDir: boolean };
