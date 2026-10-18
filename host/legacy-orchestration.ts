import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type LegacyRetirementEntry = { id: string; cwd?: string; harness?: string };
export type LegacyRetirementManifest = {
  manifestId: "host-orchestration-v1";
  sourceKey: string;
  entries: LegacyRetirementEntry[];
};

/** This file is authored by native bootstrap, not by a device RPC client. */
export function readLegacyRetirementManifest(
  path: string,
  desktopDirectory: string,
): LegacyRetirementManifest {
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (input?.manifestId !== "host-orchestration-v1" || !Array.isArray(input.entries))
    throw new Error("Unsupported legacy orchestration retirement manifest");
  const ids = new Set<string>();
  const entries = input.entries.map((entry: unknown) => {
    const value = entry as Record<string, unknown>;
    if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value.id) || ids.has(value.id))
      throw new Error("Invalid retired orchestration session ID");
    for (const key of ["cwd", "harness"] as const) {
      if (value[key] !== undefined && (typeof value[key] !== "string" || (value[key] as string).includes("\0")))
        throw new Error("Invalid retired orchestration identity");
    }
    ids.add(value.id);
    return { id: value.id,
      ...(value.cwd !== undefined ? { cwd: value.cwd as string } : {}),
      ...(value.harness !== undefined ? { harness: value.harness as string } : {}),
    };
  });
  return {
    manifestId: input.manifestId,
    sourceKey: createHash("sha256").update(resolve(join(desktopDirectory, "monocode.db"))).digest("hex"),
    entries,
  };
}
