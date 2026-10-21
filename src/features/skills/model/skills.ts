import { isCancelledError, queryOptions } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import {
  createPath,
  homeDir,
  listSkills,
  readTextFile,
  writeTextFile,
} from "../../../platform/tauri/fs";
import { invalidateProjectFiles } from "../../connections/files/model/fileIndex";
import { joinPath } from "../../../shared/lib/paths";
import { isLocalProject, normalizeProjectPath } from "../../projects/model/recents";
import type { HarnessId } from "../../sessions/model/session";
import { getHarness } from "../../../integrations/harness/core/registry";
import { CREATE_SKILL_BODY } from "./createSkill";
import type { Skill, NativeSkill, FileSkill, BuiltinSkill } from "./skillTypes";
import { mergeCatalog } from "./skillCatalog";
import { skillNamesInText, injectSkillPrompt } from "./skillPrompt";

export type { Skill, BuiltinSkill } from "./skillTypes";
export { BUILTIN_CREATE_SKILL, mergeCatalog } from "./skillCatalog";
export { skillNamesInText, skillTextParts, injectSkillPrompt } from "./skillPrompt";

export {
  rankSkills,
  replaceSlashToken,
  slashTokenAt,
  type SlashToken,
} from "./slashCommands";

const DISABLED_SKILL_PATHS_KEY = "omnicode.disabledSkillPaths";

/** Fired on `window` when a skill is enabled or disabled in Settings. */
export const SKILLS_CHANGE_EVENT = "omnicode:skills-change";

export function loadDisabledSkillPaths(): string[] {
  try {
    const raw = localStorage.getItem(DISABLED_SKILL_PATHS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === "string")
      : [];
  } catch {
    // private mode / quota
    return [];
  }
}

export function saveDisabledSkillPaths(paths: string[]): void {
  try {
    localStorage.setItem(DISABLED_SKILL_PATHS_KEY, JSON.stringify(paths));
  } catch {
    throw new Error("Could not save skill preferences");
  }
  // The composer catalog caches per context; drop it so the next picker or
  // prompt sees the change immediately.
  invalidateSkills();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
}

function disabledSkillPathSet(): Set<string> {
  return new Set(loadDisabledSkillPaths());
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NATIVE_SKILL_TTL_MS = 30_000;
const NATIVE_SKILL_RETRY_MS = 5_000;

export type SkillCatalogContext = {
  harness: HarnessId;
  cwd: string;
  sessionId?: string;
};

type SkillCatalog = { skills: Skill[]; failed: boolean };

export const skillCatalogKeys = {
  all: ["skills", "catalog"] as const,
  cwd: (cwd: string) => ["skills", "catalog", normalizeProjectPath(cwd)] as const,
};

export function skillCatalogQuery(context: SkillCatalogContext) {
  const normalized = { ...context, cwd: normalizeProjectPath(context.cwd) };
  const sessionScoped = !!getHarness(context.harness)?.commands?.subscribe;
  const queryKey = [...skillCatalogKeys.cwd(normalized.cwd), context.harness, sessionScoped ? context.sessionId ?? null : null] as const;
  const native = hasNativeCommands(context.harness);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<SkillCatalog> => {
      try {
        return { skills: await loadCatalog(normalized), failed: false };
      } catch {
        // Provider discovery is optional. Keep the last inventory and use a
        // short freshness window after failure rather than caching it for 30s.
        return {
          skills: native ? queryClient.getQueryData<SkillCatalog>(queryKey)?.skills ?? [] : mergeCatalog([]),
          failed: true,
        };
      }
    },
    staleTime: (query) => native
      ? query.state.data?.failed ? NATIVE_SKILL_RETRY_MS : NATIVE_SKILL_TTL_MS
      : Infinity,
    select: (catalog: SkillCatalog) => catalog.skills,
  });
}

export function skillCatalogKey(context: SkillCatalogContext): string {
  const sessionScoped = !!getHarness(context.harness)?.commands?.subscribe;
  return `${context.harness}\0${normalizeProjectPath(context.cwd)}${sessionScoped && context.sessionId ? `\0${context.sessionId}` : ""}`;
}

export function hasNativeCommands(harness: HarnessId): boolean {
  return !!getHarness(harness)?.commands;
}

export function isNativeCommandPrompt(
  text: string,
  harness: HarnessId,
): boolean {
  return (
    getHarness(harness)?.commands?.rawSlashCommands === true &&
    /^\s*\/[^\s/\\]+(?=\s|$)/.test(text)
  );
}

/** A live update supersedes any cold probe already in flight. */
export function subscribeSkills(
  context: SkillCatalogContext,
): () => void {
  return (
    getHarness(context.harness)?.commands?.subscribe?.(context, (commands) => {
      const queryKey = skillCatalogQuery(context).queryKey;
      const skills: Skill[] = commands.map((command) => ({
        ...command,
        kind: "native",
      }));
      // Cancellation is synchronous; publish the live inventory before any
      // rejected cold-probe consumer resumes on its next microtask.
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, { skills, failed: false });
    }) ?? (() => undefined)
  );
}

export function peekSkills(context: SkillCatalogContext): Skill[] | null {
  return queryClient.getQueryData(skillCatalogQuery(context).queryKey)?.skills ?? null;
}

export const skillDocumentQuery = (path: string) => queryOptions({
  queryKey: ["skills", "document", path],
  queryFn: () => readTextFile(path),
});

export function invalidateSkills(context?: { cwd: string }) {
  const queryKey = context ? skillCatalogKeys.cwd(context.cwd) : skillCatalogKeys.all;
  void queryClient.cancelQueries({ queryKey });
  return invalidateAfterChange(queryKey);
}

export function loadSkills(
  context: SkillCatalogContext,
  options?: { refresh?: boolean },
): Promise<Skill[]> {
  const query = skillCatalogQuery(context);
  if (options?.refresh) {
    // Opening the picker may request fresh files, but shares an ongoing scan.
    void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: "none" });
  }
  return queryClient.fetchQuery(query).then((catalog) => catalog.skills).catch(async (error: unknown) => {
    if (!isCancelledError(error)) throw error;
    const current = queryClient.getQueryCache().find<SkillCatalog>({ queryKey: query.queryKey, exact: true });
    if (current?.state.fetchStatus === "fetching" && current.promise) return (await current.promise).skills;
    return peekSkills(context) ?? (hasNativeCommands(context.harness) ? [] : mergeCatalog([]));
  });
}

async function loadCatalog(context: SkillCatalogContext): Promise<Skill[]> {
  const provider = getHarness(context.harness)?.commands;
  if (provider) {
    const commands = await provider.discover(context);
    return commands.map((command): NativeSkill => ({
      kind: "native",
      ...command,
    }));
  }
  const disabledPaths = loadDisabledSkillPaths();
  const discovered = await listSkills(context.cwd, disabledPaths);
  const disabled = disabledSkillPathSet();
  return mergeCatalog(discovered.filter((skill) => !disabled.has(skill.path)));
}

export async function applySkillsToTurn(
  text: string,
  context: SkillCatalogContext,
): Promise<string> {
  if (hasNativeCommands(context.harness)) return text;
  const names = skillNamesInText(text);
  if (names.length === 0) return text;
  const catalog = await loadSkills(context);
  const picked: Array<FileSkill | BuiltinSkill> = [];
  for (const name of names) {
    const skill = catalog.find((item) => item.name === name);
    if (skill?.kind === "file" || skill?.kind === "builtin") {
      picked.push(skill);
    }
  }
  if (picked.length === 0) return text;
  const bodies: Record<string, string> = {};
  await Promise.all(
    picked.map(async (skill) => {
      bodies[skill.name] = await readSkillBody(skill);
    }),
  );
  return injectSkillPrompt(text, picked, bodies);
}

type SkillLoader = typeof loadSkills;

export function warmNativeSkills(
  context: SkillCatalogContext,
  load: SkillLoader = loadSkills,
): void {
  if (!hasNativeCommands(context.harness)) return;
  void load(context).catch(() => undefined);
}

export async function readSkillBody(
  skill: FileSkill | BuiltinSkill,
): Promise<string> {
  if (skill.kind === "builtin") return CREATE_SKILL_BODY;
  try {
    return await queryClient.fetchQuery(skillDocumentQuery(skill.path));
  } catch {
    return `Skill "${skill.name}" could not be read from ${skill.path}.`;
  }
}

export function slugSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && name.length <= 64;
}

export function titleFromSkillName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function blankSkillMarkdown(name: string): string {
  const title = titleFromSkillName(name);
  const words = name.replace(/-/g, " ");
  return `---
name: ${name}
description: ${title}. Use when the user asks to ${words}.
---

# ${title}

## Instructions

`;
}

export async function createBlankSkill(input: {
  cwd: string;
  name: string;
  scope: "project" | "user";
}): Promise<string> {
  const name = slugSkillName(input.name);
  if (!isValidSkillName(name)) {
    throw new Error("Use a lowercase name with letters, numbers, and hyphens.");
  }
  const root =
    input.scope === "user" || !isLocalProject(input.cwd)
      ? await homeDir()
      : input.cwd;
  const relative = `.agents/skills/${name}`;
  await createPath(root, relative, true);
  const path = joinPath(root, `${relative}/SKILL.md`);
  await writeTextFile(path, blankSkillMarkdown(name));
  await invalidateSkills(input.scope === "user" || !isLocalProject(input.cwd) ? undefined : { cwd: input.cwd });
  void invalidateProjectFiles(input.cwd);
  return path;
}
