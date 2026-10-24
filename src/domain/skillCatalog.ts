import type { DiscoveredSkill, BuiltinSkill, FileSkill, Skill } from "../contracts/skills";



import { CREATE_SKILL_NAME, CREATE_SKILL_DESCRIPTION } from "./createSkill";

export const BUILTIN_CREATE_SKILL: BuiltinSkill = {
  kind: "builtin",
  name: CREATE_SKILL_NAME,
  description: CREATE_SKILL_DESCRIPTION,
  invocation: CREATE_SKILL_NAME,
  scope: "builtin",
  source: "omnicode",
};

export function mergeCatalog(discovered: DiscoveredSkill[]): Skill[] {
  const out = new Map<string, Skill>();
  const add = (skill: Skill) => {
    if (!skill.name || out.has(skill.name)) return;
    out.set(skill.name, skill);
  };
  for (const skill of discovered) {
    if (skill.source === "agents") add(asSkill(skill));
  }
  add(BUILTIN_CREATE_SKILL);
  for (const skill of discovered) {
    if (skill.source !== "agents") add(asSkill(skill));
  }
  return [...out.values()];
}

function asSkill(skill: DiscoveredSkill): FileSkill {
  return {
    kind: "file",
    name: skill.name,
    description: skill.description,
    invocation: skill.name,
    path: skill.path,
    scope: skill.scope === "user" ? "user" : "project",
    source: skill.source === "omnicode" ? "omnicode" : skill.source,
  };
}
