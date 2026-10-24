import { unwrapMarkdown } from "../../domain/notesText";
import type { Note, NoteComposerCard } from "../../contracts/session";


import { fuzzyMatch } from "../../shared/lib/fuzzy";
import type { ProjectFile } from "../../contracts/workspace";
import type { RankedFile } from "../connections/files/model/fileIndex";
import { projectName } from "../../shared/lib/paths";
import { looksLikeProject } from "../projects/model/recents";

export const NOTE_MENTION_PREFIX = "note/";
export const NOTE_PATH_PREFIX = "note:";

export const ADD_NOTE_TO_CHAT_EVENT = "omnicode:add-note-to-chat";
export const NOTES_CHANGED_EVENT = "omnicode:notes-changed";




const MAX_NOTE_PICKER = 8;
const NOTE_SLUG_RE = /(^|\s)@note\/([A-Za-z0-9_-]+)/g;

/** Canonical, case-insensitive tags for storage and filtering. */


export function isNoteMentionPath(path: string): boolean {
  return path.startsWith(NOTE_PATH_PREFIX);
}

export function noteMentionLabel(note: Note): string {
  return `${NOTE_MENTION_PREFIX}${note.slug}`;
}

export function notesAsProjectFiles(notes: Note[]): ProjectFile[] {
  return notes.map((note) => ({
    name: note.title,
    path: `${NOTE_PATH_PREFIX}${note.id}`,
    relative: noteMentionLabel(note),
  }));
}

export function rankNoteFiles(
  notes: Note[],
  query: string,
  limit = MAX_NOTE_PICKER,
): RankedFile[] {
  const needle = query.replace(/\/+$/, "").trim().toLowerCase();
  if (!needle) {
    return [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((note) => ({
        ...notesAsProjectFiles([note])[0]!,
        score: 0,
        positions: [],
      }));
  }

  const scored: { note: Note; score: number; positions: number[] }[] = [];
  for (const note of notes) {
    const titleHit = fuzzyMatch(needle, note.title);
    const slugHit = titleHit ? null : fuzzyMatch(needle, note.slug);
    const tagHit =
      titleHit || slugHit
        ? null
        : note.tags
            .map((tag) => fuzzyMatch(needle.replace(/^#/, ""), tag))
            .find(Boolean);
    const hit = titleHit ?? slugHit ?? tagHit;
    if (!hit) continue;
    scored.push({
      note,
      score: titleHit ? hit.score + 400 : tagHit ? hit.score + 200 : hit.score,
      positions: titleHit ? hit.positions : [],
    });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.note.updatedAt - a.note.updatedAt;
  });
  return scored.slice(0, limit).map((row) => ({
    ...notesAsProjectFiles([row.note])[0]!,
    score: row.score,
    positions: row.positions,
  }));
}

/** First markdown heading, or the first non-empty prose line. */


/** Folder name for a note saved from a session, or null when there is no project. */
export function noteSourceProject(cwd?: string): string | null {
  if (!cwd || !looksLikeProject(cwd)) return null;
  const name = projectName(cwd);
  return name || null;
}

export function notePreview(text: string, title: string): string {
  const parts: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s{0,3}#{1,6}\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const next = unwrapMarkdown(trimmed.replace(/^[-*+]\s+/, ""));
    if (!next || next === title) continue;
    parts.push(next);
    if (parts.join(" ").length >= 120) break;
  }
  const preview = parts.join(" ");
  if (!preview) return "";
  return preview.length > 120 ? `${preview.slice(0, 119)}…` : preview;
}

export function appendNoteReference(
  draft: string,
  title: string,
  body: string,
): string {
  const content = body.replace(/\r\n?/g, "\n").trim();
  if (!content) return draft;
  const heading = title.trim() || "Untitled";
  const block = `Note: ${heading}\n\n${content}`;
  const separator =
    draft.length === 0
      ? ""
      : draft.endsWith("\n\n")
        ? ""
        : draft.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${draft}${separator}${block}\n\n`;
}

export function noteSlugsInText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  NOTE_SLUG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOTE_SLUG_RE.exec(text))) {
    const slug = match[2];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    found.push(slug);
  }
  return found;
}

export function noteComposerCard(note: Note): NoteComposerCard {
  return {
    id: note.id,
    slug: note.slug,
    title: note.title,
    body: note.body,
    ...(note.sourceCwd ? { sourceCwd: note.sourceCwd } : {}),
  };
}


