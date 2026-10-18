import { copyFileSync, cpSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { findNativeSource, type SourceEnvironment } from "./sources";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_LINEAGE = 8;

export type CopiedNativeConversation = { path: string; dataDir: string };

/**
 * Copy a Claude Code or Codex conversation's native records into another
 * account Home, at the same relative path, so the provider can resume it by ID
 * there. Codex forks also need their source rollouts; Claude keeps subagent
 * and tool-result files in a sibling directory named after the session.
 * Returns null when the source conversation cannot be found.
 */
export function copyNativeConversation(input: {
  provider: "claude" | "codex";
  providerSessionId: string;
  fromAccountId?: string;
  toHome: string;
  context: SourceEnvironment;
}): CopiedNativeConversation | null {
  const copied = new Set<string>();
  const copy = (id: string, depth: number): CopiedNativeConversation | null => {
    copied.add(id.toLowerCase());
    const found = findNativeSource(input.provider, id, input.fromAccountId, input.context);
    if (!found) return null;
    const path = relative(found.dataDir, found.path);
    if (!path || path.startsWith("..") || isAbsolute(path))
      throw new Error("Native conversation is outside its account Home");
    const target = join(input.toHome, path);
    if (resolve(target) !== resolve(found.path)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(found.path, target);
      if (input.provider === "claude") {
        const sidecar = join(dirname(found.path), basename(found.path, extname(found.path)));
        if (isDirectory(sidecar))
          cpSync(sidecar, join(dirname(target), basename(target, extname(target))), { recursive: true, force: true });
      }
    }
    if (input.provider === "codex" && depth < MAX_LINEAGE)
      for (const lineage of basename(found.path).match(UUID) ?? [])
        if (!copied.has(lineage.toLowerCase())) copy(lineage, depth + 1);
    return { path: target, dataDir: input.toHome };
  };
  return copy(input.providerSessionId, 0);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
