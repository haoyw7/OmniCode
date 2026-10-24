/** Relative asset references persisted in note Markdown and resolved by the client. */
export const NOTE_IMAGE_PREFIX = "/note-assets/";

export function isNoteImagePath(value: string): boolean {
  return value.startsWith(NOTE_IMAGE_PREFIX);
}
