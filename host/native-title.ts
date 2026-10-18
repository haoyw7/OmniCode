import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { parseClaudeNativeTitle } from "../src/integrations/harness/core/nativeTitles";
import { defaultProviderAccountHome, namedProviderAccountHome, providerAccountDirectory } from "./provider-accounts";

/** Read metadata from the same credential home used by the provider child. */
export async function readClaudeTitleFile(
  input: { cwd: string; providerSessionId: string; providerAccountId?: string },
  desktopConfigPath?: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.providerSessionId)) return null;
  let root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const account = input.providerAccountId ?? "default";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(account)) return null;
  if (desktopConfigPath) {
    const directory = providerAccountDirectory(desktopConfigPath);
    if (!directory) return null;
    root = account === "default"
      ? defaultProviderAccountHome(directory, "claude") ?? root
      : namedProviderAccountHome(directory, "claude", account);
  } else if (account !== "default") return null;
  try {
    const projects = await realpath(join(root, "projects"));
    const path = await realpath(
      join(
        projects,
        input.cwd.replace(/[^a-zA-Z0-9]/g, "-"),
        `${input.providerSessionId}.jsonl`,
      ),
    );
    if (!path.startsWith(projects + sep)) return null;
    const info = await stat(path);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) return null;
    return parseClaudeNativeTitle(
      await readFile(path, "utf8"),
      input.providerSessionId,
    );
  } catch {
    return null;
  }
}
