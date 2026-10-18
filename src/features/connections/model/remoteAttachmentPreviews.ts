import { walkTranscript } from "../../sessions/model/agentTranscript";
import type { Block } from "../../sessions/model/session";
import type { HostSession } from "./protocol";

type Chunk = { data: string; offset: number; size: number };
const downloads = new Map<string, Promise<string>>();
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

const missingPreview = (file: NonNullable<Block["attachments"]>[number]) =>
  file.kind === "image" &&
  !file.data &&
  !file.previewUrl &&
  file.size <= MAX_PREVIEW_BYTES;

/** Whether `withRemoteAttachmentPreviews` still has images to download. */
export function needsRemoteAttachmentPreviews(snapshot: HostSession): boolean {
  for (const block of walkTranscript(snapshot.session.blocks))
    if (block.attachments?.some(missingPreview)) return true;
  return false;
}

/** Carry already downloaded bytes without making text sync await image I/O.
 * Only matching files in the current blocks are reused; old blocks/metadata
 * never replace a newer revision. */
export function reuseRemoteAttachmentPreviews(
  snapshot: HostSession,
  known: HostSession | undefined,
): HostSession {
  if (!known || known.session.id !== snapshot.session.id || snapshot === known)
    return snapshot;
  const previous = new Map(
    [...walkTranscript(known.session.blocks)].flatMap((block) => block.attachments ?? [])
      .filter((file) => file.data !== undefined)
      .map((file) => [file.id, file]),
  );
  if (!previous.size) return snapshot;
  let changed = false;
  const visit = (rows: Block[]): Block[] => rows.map((block) => {
    if (block.agentRun?.transcript) {
      const transcript = visit(block.agentRun.transcript);
      if (transcript.some((row, index) => row !== block.agentRun!.transcript![index])) {
        changed = true; block = { ...block, agentRun: { ...block.agentRun, transcript } };
      }
    }
    let blockChanged = false;
    const attachments = block.attachments?.map((file) => {
      const before = previous.get(file.id);
      if (file.kind !== "image" || file.data !== undefined || file.previewUrl ||
          !before || before.kind !== file.kind || before.size !== file.size ||
          before.mimeType !== file.mimeType || before.path !== file.path)
        return file;
      blockChanged = changed = true;
      return { ...file, data: before.data };
    });
    return blockChanged ? { ...block, attachments } : block;
  });
  const blocks = visit(snapshot.session.blocks);
  return changed ? { ...snapshot, session: { ...snapshot.session, blocks } } : snapshot;
}

/** Preview bytes live only in desktop snapshots, not in every host database
 * write. Unchanged attachments reuse their previous data across delta syncs. */
export async function withRemoteAttachmentPreviews(
  machineId: string,
  snapshot: HostSession,
  known: HostSession | undefined,
  read: (params: {
    sessionId: string;
    id: string;
    offset: number;
  }) => Promise<Chunk>,
): Promise<HostSession> {
  const previous = new Map(
    [...walkTranscript(known?.session.id === snapshot.session.id ? known.session.blocks : [])]
      .flatMap((block) => block.attachments ?? [])
      .map((file) => [file.id, file]),
  );
  let changed = false;
  const visit = (rows: Block[]): Promise<Block[]> => Promise.all(
    rows.map(async (block) => {
      if (block.agentRun?.transcript) {
        const transcript = await visit(block.agentRun.transcript);
        if (transcript.some((row, index) => row !== block.agentRun!.transcript![index])) {
          changed = true; block = { ...block, agentRun: { ...block.agentRun, transcript } };
        }
      }
      if (!block.attachments?.length) return block;
      const attachments = await Promise.all(
        block.attachments.map(async (file) => {
          if (!missingPreview(file)) return file;
          try {
            let data = previous.get(file.id)?.data;
            if (data === undefined) {
              const key = JSON.stringify([
                machineId,
                snapshot.session.id,
                file.id,
              ]);
              let download = downloads.get(key);
              if (!download) {
                download = (async () => {
                  const pieces: string[] = [];
                  let offset = 0;
                  while (offset < file.size) {
                    const chunk = await read({
                      sessionId: snapshot.session.id,
                      id: file.id,
                      offset,
                    });
                    if (
                      chunk.size !== file.size ||
                      chunk.offset <= offset ||
                      chunk.offset > file.size ||
                      atob(chunk.data).length !== chunk.offset - offset ||
                      (chunk.offset < file.size &&
                        (chunk.offset - offset) % 3 !== 0)
                    )
                      throw new Error("Invalid image transfer");
                    pieces.push(chunk.data);
                    offset = chunk.offset;
                  }
                  return pieces.join("");
                })().finally(() => downloads.delete(key));
                downloads.set(key, download);
              }
              data = await download;
            }
            return { ...file, data };
          } catch {
            // Missing images must not hide the conversation or mark its host offline.
            return file;
          }
        }),
      );
      if (
        attachments.every((file, index) => file === block.attachments![index])
      )
        return block;
      changed = true;
      return { ...block, attachments };
    }),
  );
  const blocks = await visit(snapshot.session.blocks);
  return changed
    ? { ...snapshot, session: { ...snapshot.session, blocks } }
    : snapshot;
}
