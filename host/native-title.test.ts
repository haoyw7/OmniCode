import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeTitleFile } from "./native-title";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
it.each([[false, "one"], [true, "one"], [true, "default"]] as const)("reads the selected Claude account's metadata with custom Home %s and profile %s", async (custom, selected) => {
  const root = mkdtempSync(join(tmpdir(), "monocode-native-title-"));
  directories.push(root);
  const config = join(root, "desktop.json");
  writeFileSync(config, JSON.stringify({ desktopDirectory: root }));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "inherited"));
  const profileHome = (account: string) => custom ? join(root, `external-${account}`) : join(root, "provider-accounts", "claude", account);
  if (custom) {
    mkdirSync(join(root, "provider-accounts"));
    writeFileSync(join(root, "provider-accounts/accounts.json"), JSON.stringify({ claude: ["one", "two", "default"].map(id => ({ id, label: id, dataHome: profileHome(id) })) }));
  }
  for (const account of ["one", "two", "default"]) {
    const project = join(profileHome(account), "projects", "-project");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "native.jsonl"),
      JSON.stringify({
        type: "ai-title",
        sessionId: "native",
        aiTitle: `${account} title`,
      }) + "\n{unfinished",
    );
  }
  expect(
    await readClaudeTitleFile(
      {
        cwd: "/project",
        providerSessionId: "native",
        providerAccountId: selected,
      },
      config,
    ),
  ).toBe(`${selected} title`);
  expect(
    await readClaudeTitleFile(
      {
        cwd: "/project",
        providerSessionId: "../native",
        providerAccountId: "one",
      },
      config,
    ),
  ).toBeNull();
  expect(
    await readClaudeTitleFile({
      cwd: "/project",
      providerSessionId: "native",
      providerAccountId: "one",
    }),
  ).toBeNull();
});
it("rejects a transcript symlink outside the provider's projects directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "monocode-native-title-"));
  directories.push(root);
  const project = join(root, "projects", "-project");
  mkdirSync(project, { recursive: true });
  const outside = join(root, "outside.jsonl");
  writeFileSync(
    outside,
    JSON.stringify({
      type: "ai-title",
      sessionId: "native",
      aiTitle: "Other data",
    }),
  );
  symlinkSync(outside, join(project, "native.jsonl"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", root);
  expect(
    await readClaudeTitleFile({ cwd: "/project", providerSessionId: "native" }),
  ).toBeNull();
});
