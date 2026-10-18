import type { Skill } from "./skillTypes";
import { isMarkdownBlockquotePosition } from "../../sessions/model/quoteDraft";

const SKILL_TOKEN_RE =
  /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?)(?=\s|$)/g;
export function skillNamesInText(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  SKILL_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_RE.exec(text))) {
    const name = match[2];
    const start = match.index + (match[1]?.length ?? 0);
    if (!name || seen.has(name) || isMarkdownBlockquotePosition(text, start)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type SkillTextPart = {
  text: string;
  skill: boolean;
};

/** Split composer text so known `/skill` tokens can be highlighted. */
export function skillTextParts(
  text: string,
  names: ReadonlySet<string>,
): SkillTextPart[] {
  if (!text) return [];
  if (names.size === 0) return [{ text, skill: false }];

  const parts: SkillTextPart[] = [];
  const push = (value: string, skill: boolean) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.skill === skill) {
      last.text += value;
      return;
    }
    parts.push({ text: value, skill });
  };

  SKILL_TOKEN_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_RE.exec(text))) {
    const name = match[2];
    const lead = match[1] ?? "";
    const start = match.index + lead.length;
    if (
      !name ||
      !names.has(name) ||
      isMarkdownBlockquotePosition(text, start)
    ) {
      continue;
    }
    const end = start + 1 + name.length;
    push(text.slice(cursor, start), false);
    push(text.slice(start, end), true);
    cursor = end;
  }
  push(text.slice(cursor), false);
  return parts;
}

export function injectSkillPrompt(
  text: string,
  skills: Skill[],
  bodies: Record<string, string>,
): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    const body = bodies[skill.name]?.trim();
    if (!body) continue;
    blocks.push(`## /${skill.name}\n\n${body}`);
  }
  if (blocks.length === 0) return text;
  return [
    "The user invoked skill(s) with /name. Follow every instruction in each skill body.",
    "",
    blocks.join("\n\n"),
    "",
    "---",
    "",
    text,
  ].join("\n");
}
