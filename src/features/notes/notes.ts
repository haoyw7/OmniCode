import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../shared/lib/queryClient";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  NOTES_CHANGED_EVENT,
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

export const noteKeys = { all: ["notes"] as const, list: ["notes", "list"] as const };
export const notesQuery = () => queryOptions({
  queryKey: noteKeys.list,
  queryFn: () => invoke<Note[]>("notes_list"),
});

export function peekNotes(): Note[] | null {
  return queryClient.getQueryData(noteKeys.list) ?? null;
}

export async function invalidateNotes() {
  await queryClient.cancelQueries({ queryKey: noteKeys.all });
  await invalidateAfterChange(noteKeys.all);
}

export async function loadNotes(refresh = false): Promise<Note[]> {
  if (refresh) await invalidateNotes();
  // Optional prompt enrichment retains the last usable notes on failure;
  // mounted editors use notesQuery directly and expose the actual error.
  return queryClient.fetchQuery({ ...notesQuery(), staleTime: Infinity })
    .catch(() => peekNotes() ?? []);
}

export async function upsertNote(note: NoteUpsert): Promise<Note> {
  const saved = await invoke<Note>("notes_upsert", { note });
  await invalidateNotes();
  return saved;
}

export async function deleteNote(id: string): Promise<void> {
  await invoke("notes_delete", { id });
  await invalidateNotes();
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

if (typeof window !== "undefined") {
  window.addEventListener(NOTES_CHANGED_EVENT, () => { void invalidateNotes(); });
}
