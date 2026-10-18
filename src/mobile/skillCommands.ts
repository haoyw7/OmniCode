import type { Skill } from "../features/skills/model/skillTypes";
import {
  replaceSlashToken,
  slashTokenAt,
} from "../features/skills/model/slashCommands";

/** Reuse slash replacement; plain caret insertion adds only needed whitespace. */
export function insertMobileSkill(
  text: string,
  start: number,
  end: number,
  skill: Skill,
) {
  const token = slashTokenAt(text, start, true);
  if (token) {
    const next = replaceSlashToken(text, token, skill.invocation);
    const after = token.start + skill.invocation.length + 1;
    return { text: next, cursor: after + Number(next[after] === " ") };
  }
  const before = text.slice(0, start);
  const rest = text.slice(Math.max(start, end));
  const lead = before && !/\s$/.test(before) ? " " : "";
  const space = /^\s/.test(rest) ? "" : " ";
  const inserted = `${lead}/${skill.invocation}${space}`;
  return {
    text: `${before}${inserted}${rest}`,
    cursor:
      before.length + inserted.length + Number(!space && rest.startsWith(" ")),
  };
}
