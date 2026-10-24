import type { Note, NoteCardMeta, NoteComposerCard } from "../contracts/session";



export function noteCardMeta(card: NoteComposerCard): NoteCardMeta {
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    ...(card.sourceCwd ? { sourceCwd: card.sourceCwd } : {}),
  };
}


export function injectNotePrompt(text: string, notes: Note[]): string {
  if (notes.length === 0) return text;
  const blocks = notes.map((note) => {
    const heading = note.title.trim() || "Untitled";
    return [`Referenced note "${heading}":`, "", note.body.trim()].join("\n");
  });
  return [text.trimEnd(), "", "---", ...blocks].join("\n");
}


export function composeNoteMessage(
  card: NoteComposerCard | undefined,
  text: string,
): string {
  if (!card) return text.trim();
  const lead = text.trim() || "Use this note.";
  return injectNotePrompt(lead, [
    {
      id: card.id,
      slug: card.slug,
      title: card.title,
      body: card.body,
      tags: [],
      slugPending: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
}
export const MAX_TITLE = 200;

export const MAX_NOTE_TAGS = 20;

export const MAX_NOTE_TAG_LENGTH = 48;

export function normalizeNoteTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const input of tags) {
    const tag = input
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, MAX_NOTE_TAG_LENGTH)
      .replace(/-+$/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length === MAX_NOTE_TAGS) break;
  }
  return normalized;
}

export function noteTitle(text: string): string {
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
  if (heading) {
    const title = unwrapMarkdown(heading[1]).slice(0, MAX_TITLE);
    if (title) return title;
  }
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const title = unwrapMarkdown(trimmed).slice(0, MAX_TITLE);
    if (title) return title;
  }
  return "Untitled";
}

export function unwrapMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .trim();
}
