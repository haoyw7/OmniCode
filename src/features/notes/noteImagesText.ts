export const NOTE_IMAGE_PREFIX = "/note-assets/";

export type NoteImageAsset = {
  name: string;
  markdownPath: string;
};

export type MarkdownInsertion = {
  value: string;
  cursor: number;
};

export function noteImageMarkdown(image: NoteImageAsset): string {
  const alt = image.name
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]])/g, "\\$1");
  return `![${alt}](${image.markdownPath})`;
}

export function insertNoteImagesMarkdown(
  value: string,
  start: number,
  end: number,
  images: NoteImageAsset[],
): MarkdownInsertion {
  if (images.length === 0) {
    const cursor = Math.max(0, Math.min(start, value.length));
    return { value, cursor };
  }

  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const before = value.slice(0, from);
  const after = value.slice(to);
  const block = images.map(noteImageMarkdown).join("\n\n");
  const leading = before
    ? before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n"
    : "";
  const trailing = after
    ? after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n"
    : "";
  const inserted = `${leading}${block}`;

  return {
    value: `${before}${inserted}${trailing}${after}`,
    cursor: before.length + inserted.length,
  };
}

export function isNoteImagePath(value: string): boolean {
  return value.startsWith(NOTE_IMAGE_PREFIX);
}
