import { machineFs, machinePath, currentMachineIO } from "./machine-io";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  HostSkillCatalog,
  RemoteProvider,
} from "../src/features/connections/model/protocol";
import type { DiscoveredSkill } from "../src/platform/tauri/fs";
import { mergeCatalog } from "../src/features/skills/model/skillCatalog";
import {
  injectSkillPrompt,
  skillNamesInText,
} from "../src/features/skills/model/skillPrompt";
import { CREATE_SKILL_BODY } from "../src/features/skills/model/createSkill";
import { nativeCommandPrompt } from "../src/integrations/harness/core/nativeCommands";
import type { HostProvider } from "./providers";

const MAX_SKILLS = 5_000;
const MAX_FRONTMATTER_BYTES = 16 * 1024;
const MAX_SKILL_BODY_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 256 * 1024;
const CACHE_TTL_MS = 30_000;
const MAX_CATALOGS = 64;
const validName = (name: string) =>
  name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
const slug = (name: string) =>
  name
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Same bounded metadata fields and folded/literal descriptions as desktop. */
export function skillMetadata(text: string, fallback: string) {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.startsWith("---")) return { name: fallback, description: "" };
  const yaml = source
    .slice(3)
    .replace(/^\r?\n/, "")
    .split(/\r?\n---/)[0];
  let name = fallback;
  let description = "";
  let multiline = false;
  let folded = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (multiline && /^[ \t]/.test(line)) {
      const piece = line.trim();
      if (piece)
        description += `${description ? (folded ? " " : "\n") : ""}${piece}`;
      continue;
    }
    multiline = false;
    const field = line.trim().match(/^(name|description):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === "name") {
      const value = unquote(field[2]);
      if (validName(value)) name = value;
    } else if (/^[>|]/.test(field[2])) {
      description = "";
      multiline = true;
      folded = field[2].startsWith(">");
    } else description = unquote(field[2]);
  }
  return { name, description: description.trim() };
}

async function prefix(
  path: string,
  limit: number,
  complete = false,
): Promise<string> {
  if (currentMachineIO().key !== "local") {
    const info = await machineFs.stat(path);
    if (!info.isFile() || (complete && info.size > limit))
      throw new Error("Skill file is too large or not a regular file");
    return new TextDecoder("utf-8", { fatal: true }).decode(await machineFs.readPrefix(path, limit));
  }
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || (complete && info.size > limit))
      throw new Error("Skill file is too large or not a regular file");
    const bytes = Buffer.alloc(Math.min(limit, info.size));
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await file.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, bytesRead),
    );
  } finally {
    await file.close();
  }
}

async function json(path: string): Promise<Record<string, any>> {
  try {
    const value = JSON.parse(await prefix(path, MAX_SETTINGS_BYTES, true));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function managedRoot() {
  return process.platform === "win32"
    ? "C:\\Program Files\\ClaudeCode"
    : process.platform === "darwin"
      ? "/Library/Application Support/ClaudeCode"
      : "/etc/claude-code";
}

/** Registered Claude plugin namespaces/settings follow the desktop scanner. */
async function pluginRoots(project: string, home: string, managed: string) {
  const registry = (
    await json(machinePath.join(home, ".claude/plugins/installed_plugins.json"))
  ).plugins;
  if (!registry || typeof registry !== "object" || Array.isArray(registry))
    return [];
  let settingsProject = project;
  for (let path = project; ; path = machinePath.dirname(path)) {
    const found = await Promise.all(
      ["settings.local.json", "settings.json"].map((name) =>
        machineFs.stat(machinePath.join(path, ".claude", name)).then(
          (info) => info.isFile(),
          () => false,
        ),
      ),
    );
    if (found.some(Boolean)) {
      settingsProject = path;
      break;
    }
    if (machinePath.dirname(path) === path) break;
  }
  const localSettings = await Promise.all(
    [
      machinePath.join(settingsProject, ".claude/settings.local.json"),
      machinePath.join(settingsProject, ".claude/settings.json"),
      machinePath.join(home, ".claude/settings.json"),
    ].map(json),
  );
  const managedFiles = (
    await machineFs.readdir(machinePath.join(managed, "managed-settings.d")).catch(() => [])
  )
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort();
  const managedSettings = await Promise.all(
    [
      machinePath.join(managed, "managed-settings.json"),
      ...managedFiles.map((name) => machinePath.join(managed, "managed-settings.d", name)),
    ].map(json),
  );
  const expand = async (path: string) => {
    if (currentMachineIO().key !== "local" && /^(?:[a-z]:[\\/]|\\\\)/i.test(path))
      return currentMachineIO().hostPath(path);
    return path === "~" ? home : path.startsWith("~/")
      ? machinePath.join(home, path.slice(2)) : machinePath.isAbsolute(path)
        ? path : machinePath.resolve(home, path);
  };
  const roots: Array<{
    path: string;
    scope: "project" | "user";
    namespace: string;
  }> = [];
  for (const [id, installed] of Object.entries(registry)) {
    const namespace = id.includes("@") ? id.slice(0, id.lastIndexOf("@")) : id;
    if (!validName(namespace)) continue;
    let enabled: boolean | undefined;
    for (const setting of managedSettings)
      if (typeof setting.enabledPlugins?.[id] === "boolean")
        enabled = setting.enabledPlugins[id];
    if (enabled === undefined)
      enabled = localSettings
        .map((setting) => setting.enabledPlugins?.[id])
        .find((value) => typeof value === "boolean");
    if (enabled === false) continue;
    for (const entry of Array.isArray(installed) ? installed : [installed]) {
      if (!entry || typeof entry.installPath !== "string") continue;
      const scope = entry.scope ?? "user";
      if (!["project", "local", "user"].includes(scope)) continue;
      if (scope !== "user") {
        if (typeof entry.projectPath !== "string") continue;
        const [actual, root] = await Promise.all([
          machineFs.realpath(project),
          machineFs.realpath(await expand(entry.projectPath)),
        ]).catch(() => ["", ""]);
        const rel = machinePath.relative(root, actual);
        if (
          !actual ||
          !root ||
          rel === ".." ||
          rel.startsWith(`..${machinePath.sep}`) ||
          machinePath.isAbsolute(rel)
        )
          continue;
      }
      roots.push({
        path: machinePath.join(await expand(entry.installPath), "skills"),
        scope: scope === "user" ? "user" : "project",
        namespace,
      });
    }
  }
  return roots.sort(
    (a, b) => Number(a.scope === "user") - Number(b.scope === "user"),
  );
}

export async function discoverHostSkills(
  cwd: string,
  home = homedir(),
  managed = managedRoot(),
): Promise<DiscoveredSkill[]> {
  if (currentMachineIO().key !== "local") {
    [home, managed] = await Promise.all([currentMachineIO().hostPath(home), currentMachineIO().hostPath(managed)]);
  }
  const roots: Array<{
    path: string;
    scope: "project" | "user";
    source: DiscoveredSkill["source"];
    namespace?: string;
  }> = [
    { path: machinePath.join(cwd, ".agents/skills"), scope: "project", source: "agents" },
    { path: machinePath.join(home, ".agents/skills"), scope: "user", source: "agents" },
  ];
  for (const source of [
    "claude",
    "cursor",
    "codex",
    "opencode",
    "pi",
    "omp",
    "fx",
    "grok",
    "hermes",
  ] as const) {
    roots.push({
      path: machinePath.join(cwd, `.${source}/skills`),
      scope: "project",
      source,
    });
    roots.push({
      path: machinePath.join(home, `.${source}/skills`),
      scope: "user",
      source,
    });
  }
  roots.push(
    { path: machinePath.join(home, ".pi/agent/skills"), scope: "user", source: "pi" },
    { path: machinePath.join(home, ".omp/agent/skills"), scope: "user", source: "omp" },
    {
      path: machinePath.join(home, ".gemini/antigravity/skills"),
      scope: "user",
      source: "antigravity",
    },
  );
  const plugins = await pluginRoots(cwd, home, managed);
  const found = new Map<string, DiscoveredSkill>();
  const seenRoots = new Set<string>();
  for (const root of [
    ...roots,
    ...plugins.map((plugin) => ({ ...plugin, source: "claude" as const })),
  ]) {
    if (found.size >= MAX_SKILLS) break;
    if (!root.namespace) {
      const key = await machineFs.realpath(root.path).catch(() => root.path);
      if (seenRoots.has(key)) continue;
      seenRoots.add(key);
    }
    const entries = await machineFs.readdir(root.path, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (found.size >= MAX_SKILLS) break;
      if (entry.name.startsWith(".") || entry.name === "skills-cursor")
        continue;
      const dir = machinePath.join(root.path, entry.name);
      if (
        !(await machineFs.stat(dir).then(
          (info) => info.isDirectory(),
          () => false,
        ))
      )
        continue;
      const fallback = slug(entry.name);
      if (!fallback) continue;
      const path =
        (await machineFs.stat(machinePath.join(dir, "SKILL.md")).then(
          (info) => (info.isFile() ? machinePath.join(dir, "SKILL.md") : undefined),
          () => undefined,
        )) ??
        (await machineFs.stat(machinePath.join(dir, "skill.md")).then(
          (info) => (info.isFile() ? machinePath.join(dir, "skill.md") : undefined),
          () => undefined,
        ));
      if (!path) continue;
      const text = await prefix(path, MAX_FRONTMATTER_BYTES).catch(
        () => undefined,
      );
      if (text === undefined) continue;
      const metadata = skillMetadata(text, fallback);
      const name = root.namespace
        ? `${root.namespace}:${metadata.name}`
        : metadata.name;
      if (!found.has(name))
        found.set(name, {
          ...metadata,
          name,
          path,
          scope: root.scope,
          source: root.source,
        });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type SkillContext = {
  harness: RemoteProvider;
  cwd: string;
  sessionId?: string;
};
type Entry = {
  catalog?: HostSkillCatalog;
  at: number;
  revision: number;
  loading?: Promise<HostSkillCatalog>;
  unsubscribe?: () => void;
};

/** The Host owns reads, native discovery, caching and prompt preparation. */
export class HostSkills {
  private entries = new Map<string, Entry>();
  private closed = false;
  constructor(
    private readonly home = homedir(),
    private readonly managed = managedRoot(),
  ) {}

  async list(
    context: SkillContext,
    provider: HostProvider,
    refresh = false,
  ): Promise<HostSkillCatalog> {
    const key = `${currentMachineIO().key}\0${context.harness}\0${context.cwd}\0${provider.commands?.subscribe ? (context.sessionId ?? "") : ""}`;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.closed) throw new Error("Host stopped");
      if (this.entries.size >= MAX_CATALOGS) {
        const oldest = this.entries.keys().next().value!;
        this.entries.get(oldest)?.unsubscribe?.();
        this.entries.delete(oldest);
      }
      entry = { at: 0, revision: 0 };
      this.entries.set(key, entry);
      const owned = entry;
      entry.unsubscribe = provider.commands?.subscribe?.(
        context,
        (commands) => {
          if (this.closed || this.entries.get(key) !== owned) return;
          owned.revision++;
          owned.catalog = {
            skills: commands.map((command) => ({ ...command, kind: "native" })),
            native: true,
            canCompact: !!provider.compact,
          };
          owned.at = Date.now();
        },
      );
    }
    if (entry.loading) return entry.loading;
    if (!refresh && entry.catalog && Date.now() - entry.at < CACHE_TTL_MS)
      return entry.catalog;
    const owned = entry;
    const revision = owned.revision;
    owned.loading = (async (): Promise<HostSkillCatalog> => ({
      skills: provider.commands
        ? (await provider.commands.discover(context)).map((command) => ({
            ...command,
            kind: "native",
          }))
        : mergeCatalog(
            await discoverHostSkills(context.cwd, this.home, this.managed),
          ),
      native: !!provider.commands,
      canCompact: !!provider.compact,
    }))()
      .then((catalog) => {
        if (owned.revision !== revision && owned.catalog) return owned.catalog;
        owned.catalog = catalog;
        owned.at = Date.now();
        return catalog;
      })
      .finally(() => {
        owned.loading = undefined;
      });
    return owned.loading;
  }

  async prepare(
    text: string,
    context: SkillContext,
    provider: HostProvider,
  ): Promise<string> {
    if (provider.commands) return nativeCommandPrompt(context.harness, text);
    const names = skillNamesInText(text);
    if (!names.length) return text;
    const catalog = await this.list(context, provider);
    const picked = catalog.skills.filter(
      (skill) => skill.kind !== "native" && names.includes(skill.name),
    );
    const bodies: Record<string, string> = {};
    let total = 0;
    for (const skill of picked) {
      if (skill.kind === "native") continue;
      const body =
        skill.kind === "builtin"
          ? CREATE_SKILL_BODY
          : await prefix(skill.path, MAX_SKILL_BODY_BYTES, true).catch(
              () =>
                `Skill "${skill.name}" could not be read from ${skill.path}.`,
            );
      total += Buffer.byteLength(body);
      if (total > MAX_SKILL_BODY_BYTES)
        throw new Error(
          "Selected skills are too large to include in one message",
        );
      bodies[skill.name] = body;
    }
    return injectSkillPrompt(text, picked, bodies);
  }

  close() {
    this.closed = true;
    for (const entry of this.entries.values()) entry.unsubscribe?.();
    this.entries.clear();
  }
}
