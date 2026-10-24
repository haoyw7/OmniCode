import { notesHostRequest } from "./notesHost";
import { readBinaryFile } from "../../platform/tauri/fs";
import { attachmentsFromFiles, attachmentsFromPaths, revokeAttachment } from "../sessions/model/attachments";
import type { Attachment } from "../../contracts/session";

import type { NoteImageAsset } from "../../contracts/notes";
export * from "./noteImagesText";

export async function saveNoteImagesFromFiles(
  noteId: string,
  files: File[],
): Promise<NoteImageAsset[]> {
  return saveNoteImageAttachments(noteId, await attachmentsFromFiles(files));
}

export async function saveNoteImagesFromPaths(
  noteId: string,
  paths: string[],
): Promise<NoteImageAsset[]> {
  return saveNoteImageAttachments(noteId, await attachmentsFromPaths(paths));
}

async function saveNoteImageAttachments(
  noteId: string,
  attachments: Attachment[],
): Promise<NoteImageAsset[]> {
  const images = attachments.filter((file) => file.kind === "image");
  if (images.length === 0) {
    throw new Error("Drop a PNG, JPG, GIF, WebP, or SVG image.");
  }

  const saved: NoteImageAsset[] = [];
  let failure: unknown;
  try {
    for (const image of images) {
      try {
        let data = image.data;
        if (data === undefined && image.path) {
          const bytes = await readBinaryFile(image.path);
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 32768)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          data = btoa(binary);
        }
        if (data === undefined) continue;
        saved.push(
          await notesHostRequest<NoteImageAsset>("notes.saveImage", {
            noteId,
            name: image.name,
            data,
          }),
        );
      } catch (err: unknown) {
        failure ??= err;
      }
    }
  } finally {
    for (const image of images) revokeAttachment(image);
  }

  if (saved.length === 0) {
    if (failure instanceof Error) throw failure;
    if (failure) throw new Error(String(failure));
    throw new Error("None of the dropped images could be added to the note.");
  }
  return saved;
}
