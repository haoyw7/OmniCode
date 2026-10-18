import type { NativeCommand } from "../../../integrations/harness/core/nativeCommands";

export type SkillScope = "project" | "user" | "builtin";
export type SkillSource =
  | "agents"
  | "claude"
  | "cursor"
  | "codex"
  | "opencode"
  | "pi"
  | "omp"
  | "fx"
  | "grok"
  | "hermes"
  | "antigravity"
  | "monocode";

type SkillCommon = {
  name: string;
  description: string;
  invocation: string;
};

export type FileSkill = SkillCommon & {
  kind: "file";
  path: string;
  scope: Exclude<SkillScope, "builtin">;
  source: SkillSource;
};

export type BuiltinSkill = SkillCommon & {
  kind: "builtin";
  scope: "builtin";
  source: "monocode";
};

export type NativeSkill = NativeCommand & {
  kind: "native";
};

export type Skill = FileSkill | BuiltinSkill | NativeSkill;
