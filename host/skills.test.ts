import { testProviderCapabilities } from "./test-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostSkills, HostSkills, skillMetadata } from "./skills";
import type { HostProvider } from "./providers";
import type { NativeCommand } from "../src/integrations/harness/core/nativeCommands";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omnicode-skills-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "project"),
    home = join(root, "home"),
    managed = join(root, "managed");
  for (const path of [cwd, home, managed]) mkdirSync(path);
  const catalog = new HostSkills(home, managed);
  cleanups.push(() => catalog.close());
  const write = (path: string, value: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value);
  };
  const skill = (
    base: string,
    dir: string,
    name: string,
    body = `Instructions for ${name}`,
  ) => {
    const path = join(base, dir, name, "SKILL.md");
    write(
      path,
      `---\nname: ${name}\ndescription: Review ${name}\n---\n\n${body}`,
    );
    return path;
  };
  const provider: HostProvider = {
    get interactionCapabilities() { return testProviderCapabilities(this); },
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  return { root, cwd, home, managed, catalog, write, skill, provider };
}

describe("Host skills owned by the execution computer", () => {
  it("uses desktop metadata, project/personal precedence, fallback names and compatible roots", async () => {
    const s = fixture();
    const first = s.skill(
      s.cwd,
      ".agents/skills",
      "review",
      "Project instructions",
    );
    s.skill(s.home, ".agents/skills", "review", "Personal instructions");
    s.skill(s.cwd, ".claude/skills", "review", "Native instructions");
    s.skill(s.home, ".pi/agent/skills", "personal");
    s.skill(s.home, ".gemini/antigravity/skills", "agy-skill");
    s.write(
      join(s.cwd, ".agents/skills/Fallback Folder/skill.md"),
      "---\nname: Invalid Name\ndescription: >\n  line one\n  中文 line two\n---\nBody",
    );
    s.skill(s.cwd, ".agents/skills", ".hidden");
    const skills = await discoverHostSkills(s.cwd, s.home, s.managed);
    expect(skills.find((skill) => skill.name === "review")?.path).toBe(first);
    expect(skills.find((skill) => skill.name === "personal")?.scope).toBe(
      "user",
    );
    expect(skills.find((skill) => skill.name === "agy-skill")?.source).toBe(
      "antigravity",
    );
    expect(
      skills.find((skill) => skill.name === "fallback-folder")?.description,
    ).toBe("line one 中文 line two");
    expect(skills.some((skill) => skill.path.includes(".hidden"))).toBe(false);
    expect(
      skillMetadata(
        "\uFEFF---\r\nname: valid\r\ndescription: |\r\n  one\r\n  two\r\n---",
        "fallback",
      ),
    ).toEqual({ name: "valid", description: "one\ntwo" });
  });

  it("honors Claude plugin scope, namespace and managed/local enabled settings", async () => {
    const s = fixture();
    const plugin = join(s.home, "plugins", "review-tools");
    s.skill(plugin, "skills", "audit");
    s.write(
      join(s.home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "review-tools@market": [
            { installPath: plugin, scope: "project", projectPath: s.cwd },
          ],
          "foreign@market": [
            { installPath: plugin, scope: "project", projectPath: s.home },
          ],
        },
      }),
    );
    expect(
      (await discoverHostSkills(s.cwd, s.home, s.managed)).some(
        (skill) => skill.name === "review-tools:audit",
      ),
    ).toBe(true);
    expect(
      (await discoverHostSkills(s.cwd, s.home, s.managed)).some(
        (skill) => skill.name === "foreign:audit",
      ),
    ).toBe(false);
    s.write(
      join(s.cwd, ".claude/settings.local.json"),
      JSON.stringify({ enabledPlugins: { "review-tools@market": false } }),
    );
    expect(
      (await discoverHostSkills(s.cwd, s.home, s.managed)).some(
        (skill) => skill.name === "review-tools:audit",
      ),
    ).toBe(false);
    s.write(
      join(s.managed, "managed-settings.json"),
      JSON.stringify({ enabledPlugins: { "review-tools@market": true } }),
    );
    expect(
      (await discoverHostSkills(s.cwd, s.home, s.managed)).some(
        (skill) => skill.name === "review-tools:audit",
      ),
    ).toBe(true);
    s.write(
      join(s.managed, "managed-settings.d/10-policy.json"),
      JSON.stringify({ enabledPlugins: { "review-tools@market": false } }),
    );
    expect(
      (await discoverHostSkills(s.cwd, s.home, s.managed)).some(
        (skill) => skill.name === "review-tools:audit",
      ),
    ).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "reads linked skill folders and deduplicates linked roots",
    async () => {
      const s = fixture();
      const path = s.skill(s.home, ".agents/skills", "linked");
      mkdirSync(join(s.cwd, ".agents"));
      symlinkSync(
        join(s.home, ".agents/skills"),
        join(s.cwd, ".agents/skills"),
        "dir",
      );
      const result = await discoverHostSkills(s.cwd, s.home, s.managed);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(
        join(s.cwd, ".agents/skills/linked/SKILL.md"),
      );
      expect(result[0].scope).toBe("project");
      expect(path).toBeTruthy();
    },
  );

  it("expands only actual invocations using the desktop prompt while preserving unknown/quoted text", async () => {
    const s = fixture();
    s.skill(s.cwd, ".agents/skills", "review", "Use project review rules.");
    const context = { harness: "codex" as const, cwd: s.cwd };
    const original =
      "/review Inspect code /review /unknown\n> /create-skill is a quote";
    const prepared = await s.catalog.prepare(original, context, s.provider);
    expect(prepared).toContain("Use project review rules.");
    expect(prepared.match(/## \/review/g)).toHaveLength(1);
    expect(prepared.endsWith(original)).toBe(true);
    expect(prepared).not.toContain("# Create a OmniCode skill");
    expect(
      await s.catalog.prepare("/unknown Plain text", context, s.provider),
    ).toBe("/unknown Plain text");
    expect(
      await s.catalog.prepare(
        "/create-skill Make a skill",
        context,
        s.provider,
      ),
    ).toContain("# Create a OmniCode skill");
    expect(
      await s.catalog.prepare("> /review quoted only", context, s.provider),
    ).toBe("> /review quoted only");
  });

  it("refreshes changed file catalogs and lets .agents skills override the bundled create skill", async () => {
    const s = fixture();
    const context = { harness: "codex" as const, cwd: s.cwd };
    expect(
      (await s.catalog.list(context, s.provider)).skills.some(
        (skill) => skill.kind === "builtin",
      ),
    ).toBe(true);
    s.skill(s.cwd, ".agents/skills", "create-skill", "Custom creation rules");
    const catalog = await s.catalog.list(context, s.provider, true);
    expect(
      catalog.skills.find((skill) => skill.name === "create-skill")?.kind,
    ).toBe("file");
    expect(
      await s.catalog.prepare("/create-skill Custom", context, s.provider),
    ).toContain("Custom creation rules");
  });

  it.each(["pi", "omp"] as const)(
    "keeps %s native catalogs and raw command arguments under provider ownership",
    async (harness) => {
      const s = fixture();
      s.skill(s.cwd, ".agents/skills", "audit", "Must not be injected");
      s.provider.commands = {
        rawSlashCommands: true,
        discover: vi.fn(async () => [
          {
            name: "audit",
            invocation: "skill:audit",
            source: harness,
            description: "Native 原样",
            aliases: ["a"],
            inputHint: "<file>",
          },
        ]),
      };
      const context = { harness, cwd: s.cwd };
      const catalog = await s.catalog.list(context, s.provider);
      expect(catalog).toMatchObject({
        native: true,
        skills: [
          {
            kind: "native",
            invocation: "skill:audit",
            aliases: ["a"],
            inputHint: "<file>",
          },
        ],
      });
      expect(
        await s.catalog.prepare(
          "/skill:audit @raw /literal/path",
          context,
          s.provider,
        ),
      ).toBe("/skill:audit @raw /literal/path");
      expect(
        await s.catalog.prepare(`/${harness}:plan @raw`, context, s.provider),
      ).toBe("/plan @raw");
    },
  );

  it("coalesces native discovery and a live update supersedes an older pending probe", async () => {
    const s = fixture();
    let complete!: (value: NativeCommand[]) => void;
    let publish!: (value: NativeCommand[]) => void;
    const stop = vi.fn();
    s.provider.commands = {
      discover: vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
      subscribe: (_context, update) => {
        publish = update;
        return stop;
      },
    };
    const context = {
      harness: "omp" as const,
      cwd: s.cwd,
      sessionId: "session",
    };
    const first = s.catalog.list(context, s.provider);
    const second = s.catalog.list(context, s.provider);
    publish([
      { name: "new", invocation: "new", source: "omp", description: "Live" },
    ]);
    complete([
      { name: "old", invocation: "old", source: "omp", description: "Stale" },
    ]);
    expect((await first).skills[0].name).toBe("new");
    expect((await second).skills[0].name).toBe("new");
    expect(s.provider.commands.discover).toHaveBeenCalledTimes(1);
    s.catalog.close();
    expect(stop).toHaveBeenCalledOnce();
  });
});
