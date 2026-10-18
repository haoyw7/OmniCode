/**
 * Display-only thumbnails for picked images, keyed by attachment id.
 *
 * A composer chip is 72px, but a base64 `data:` preview makes the WebView parse
 * a multi-megabyte attribute and decode the full photo on insertion. The
 * attachment itself (and what reaches the Host) keeps its original data.
 */
const LIMIT = 64;
/** Covers a 72px square at 3x for typical 4:3 photos. */
const WIDTH = 288;
const thumbnails = new Map<string, string>();

export function attachmentThumbnail(id: string): string | undefined {
  return thumbnails.get(id);
}

/** Decodes and scales off the main thread; failures fall back to the full preview. */
export async function createAttachmentThumbnail(id: string, file: Blob): Promise<void> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof URL.createObjectURL !== "function" ||
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.type === "image/gif"
  )
    return;
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: WIDTH, resizeQuality: "medium" });
    let blob: Blob | null;
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
      blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    }
    bitmap.close();
    if (!blob) return;
    thumbnails.set(id, URL.createObjectURL(blob));
    while (thumbnails.size > LIMIT) {
      const [oldest, url] = thumbnails.entries().next().value!;
      thumbnails.delete(oldest);
      URL.revokeObjectURL(url);
    }
  } catch {
    // Undecodable or unsupported formats keep the full preview.
  }
}
