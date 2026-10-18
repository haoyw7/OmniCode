import { invoke } from "@tauri-apps/api/core";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  MAX_TITLE,
  normalizeNoteTags,
  noteTitle,
  noteSlugsInText,
  injectNotePrompt,
  noteComposerCard,
  type Note,
  type NoteUpsert,
  type NoteComposerCard,
} from "./notesText";
export * from "./notesText";

let cache: Note[] | null = null;
let inflight: Promise<Note[]> | null = null;

export function peekNotes(): Note[] | null {
  return cache;
}

export function invalidateNotes() {
  cache = null;
}

export async function loadNotes(refresh = false): Promise<Note[]> {
  if (!refresh && cache) return cache;
  if (!refresh && inflight) return inflight;

  const promise = invoke<Note[]>("notes_list")
    .then((notes) => {
      cache = notes;
      return notes;
    })
    .catch(() => {
      if (!cache) cache = [];
      return cache;
    })
    .finally(() => {
      if (inflight === promise) inflight = null;
    });
  inflight = promise;
  return promise;
}

export async function upsertNote(note: NoteUpsert): Promise<Note> {
  const saved = await invoke<Note>("notes_upsert", { note });
  cache = null;
  return saved;
}

export async function deleteNote(id: string): Promise<void> {
  await invoke("notes_delete", { id });
  cache = null;
}

export async function createNote(input: {
  title?: string;
  body?: string;
  tags?: string[];
  sourceSessionId?: string;
  sourceCwd?: string;
}): Promise<Note> {
  const body = (input.body ?? "").replace(/\r\n?/g, "\n");
  return upsertNote({
    id: crypto.randomUUID(),
    title: (input.title ?? noteTitle(body)).slice(0, MAX_TITLE),
    body,
    tags: normalizeNoteTags(input.tags ?? []),
    ...(input.sourceSessionId
      ? { sourceSessionId: input.sourceSessionId }
      : {}),
    ...(input.sourceCwd ? { sourceCwd: input.sourceCwd } : {}),
  });
}

export async function applyNotesToTurn(text: string): Promise<string> {
  const slugs = noteSlugsInText(text);
  if (slugs.length === 0) return text;
  const notes = await loadNotes();
  const picked: Note[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    const note = notes.find((item) => item.slug === slug);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    picked.push(note);
  }
  if (picked.length === 0) return text;
  return injectNotePrompt(text, picked);
}

export function requestAddNoteToChat(note: Note) {
  if (typeof window === "undefined") return;
  if (!note.body.replace(/\r\n?/g, "\n").trim()) return;
  window.dispatchEvent(
    new CustomEvent<NoteComposerCard>(ADD_NOTE_TO_CHAT_EVENT, {
      detail: noteComposerCard(note),
    }),
  );
}
