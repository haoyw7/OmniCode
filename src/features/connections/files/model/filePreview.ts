import { basename } from "../../../../platform/tauri/fs";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
]);

/**
 * Whether a path belongs to the image viewer, decided before anything is read.
 *
 * `.svg` is deliberately absent: it is text, so it keeps opening in the editor,
 * which offers its own rendered preview alongside the source.
 */
export function isImagePath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return IMAGE_EXTENSIONS.has(extension);
}

/** Byte count for the viewer footer, in the units a file manager would show. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}
