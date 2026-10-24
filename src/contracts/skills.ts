import type { NativeCommand } from "./nativeCommands";

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
  | "omnicode";

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
  source: "omnicode";
};

export type NativeSkill = NativeCommand & {
  kind: "native";
};

export type Skill = FileSkill | BuiltinSkill | NativeSkill;

export type DiscoveredSkill = {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "builtin";
  source:
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
    | "omnicode";
};
