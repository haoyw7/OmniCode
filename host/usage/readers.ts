import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseClaudeRecord } from "../../src/integrations/harness/providers/claude/claudeUsage";
import {
  parseCodexRecord,
  initialCodexScanState,
  type CodexScanState,
} from "../../src/integrations/harness/providers/codex/codexUsage";
import { parseGrokRecord } from "../../src/integrations/harness/providers/grok/grokUsage";
import {
  parsePiUsage,
  type PiUsageState,
} from "../../src/integrations/harness/providers/pi/piUsage";
import type {
  TranscriptUsageFormat,
  UsageProvider,
  UsageRecord,
  UsageSource,
} from "../../src/integrations/harness/core/usage";
import {
  configuredProviderAccountHomes,
  providerAccountDirectory,
} from "../provider-accounts";
import { canonical, usageFiles } from "./files";
import { TranscriptUsageCache } from "./transcripts";
import { scanUsageDatabase, UsageDatabaseCache } from "./databases";
import { CursorUsageReader } from "./cursor";
import { nativeSources } from "../native/sources";

const single = (record: UsageRecord | null) => (record ? [record] : []);
const format = <T>(value: TranscriptUsageFormat<T>) =>
  value as TranscriptUsageFormat;
const formats = {
  claude: format({
    initial: () => ({}),
    usageMarkers: ['"usage"'],
    parse: (value) => single(parseClaudeRecord(value)),
  }),
  codex: format<CodexScanState>({
    initial: initialCodexScanState,
    usageMarkers: [
      '"token_count"',
      '"session_meta"',
      '"turn_context"',
      '"thread_settings_applied"',
    ],
    parse: (value, state) => single(parseCodexRecord(value, state)),
    malformed: (state) => state.malformedRecords,
  }),
  grok: format({
    initial: () => ({}),
    usageMarkers: ['"turn_completed"'],
    parse: (value) => parseGrokRecord(value),
  }),
  pi: format<PiUsageState>({
    initial: () => ({ sessionId: "" }),
    usageMarkers: ['"usage"', '"session"'],
    parse: (value, state) => parsePiUsage(value, state),
  }),
  omp: format<PiUsageState>({
    initial: () => ({ sessionId: "" }),
    usageMarkers: ['"usage"', '"session"'],
    parse: (value, state) => parsePiUsage(value, state, "omp"),
  }),
};
export type ProviderUsageReader =
  | {
      kind: "transcripts";
      provider: keyof typeof formats;
      path: string;
      fileName?: string;
    }
  | {
      kind: "scan";
      provider: "opencode" | "antigravity" | "cursor";
      path: string;
    };

const homePath = (path: string) =>
  resolve(path.replace(/^~(?=[/\\]|$)/, homedir()));
export async function usageReaders(
  owner: string,
): Promise<ProviderUsageReader[]> {
  const env = process.env,
    home = homedir();
  const readers: ProviderUsageReader[] = [];
  const directory = providerAccountDirectory(owner);
  for (const provider of ["claude", "codex"] as const) {
    const builtin =
      provider === "claude"
        ? env.CLAUDE_CONFIG_DIR || join(home, ".claude")
        : env.CODEX_HOME || join(home, ".codex");
    const homes = [
      builtin,
      ...(directory
        ? configuredProviderAccountHomes(directory, provider).map(
            ([, path]) => path,
          )
        : []),
    ];
    for (const path of homes)
      readers.push({
        kind: "transcripts",
        provider,
        path: join(
          homePath(path),
          provider === "claude" ? "projects" : "sessions",
        ),
      });
  }
  readers.push({
    kind: "transcripts",
    provider: "grok",
    path: join(homePath(env.GROK_HOME || join(home, ".grok")), "sessions"),
    fileName: "updates.jsonl",
  });
  readers.push({
    kind: "transcripts",
    provider: "pi",
    path: homePath(
      env.PI_CODING_AGENT_SESSION_DIR ||
        join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "sessions"),
    ),
  });
  for (const source of nativeSources({ desktopDirectory: directory })) {
    if (source.provider === "omp" || source.provider === "codex")
      readers.push({
        kind: "transcripts",
        provider: source.provider,
        path: source.root,
      });
  }
  const openCode = env.OPENCODE_DATA_DIR?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) || [
    join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode"),
  ];
  for (const path of openCode)
    readers.push({ kind: "scan", provider: "opencode", path: homePath(path) });
  const antigravity = env.ANTIGRAVITY_DATA_DIR?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) || [
    ...(await readdir(join(home, ".gemini")).catch(() => []))
      .filter((name) => name.startsWith("antigravity"))
      .map((name) => join(home, ".gemini", name)),
    join(home, ".config", "antigravity"),
  ];
  for (const path of antigravity)
    readers.push({
      kind: "scan",
      provider: "antigravity",
      path: homePath(path),
    });
  readers.push({
    kind: "scan",
    provider: "cursor",
    path: "https://cursor.com",
  });
  const unique = new Map<string, ProviderUsageReader>();
  for (const reader of readers) {
    const path =
      reader.provider === "cursor" ? reader.path : await canonical(reader.path);
    unique.set(`${reader.provider}:${path}`, { ...reader, path });
  }
  return [...unique.values()];
}

export class UsageReaders {
  private transcripts: TranscriptUsageCache;
  private databases = new UsageDatabaseCache();
  private cursor = new CursorUsageReader();
  constructor(cache: string) {
    this.transcripts = new TranscriptUsageCache(cache);
  }

  async scan(
    reader: ProviderUsageReader,
    sinceMs: number,
    untilMs: number,
    keychain: boolean,
    refresh: boolean,
    seenFiles = new Set<string>(),
  ) {
    const identity =
      reader.provider === "cursor"
        ? ""
        : await stat(reader.path)
            .then((info) => `${info.dev}:${info.ino}`)
            .catch(() => "missing");
    const source: UsageSource = {
      id: createHash("sha256")
        .update(`${hostname()}:${reader.provider}:${reader.path}:${identity}`)
        .digest("hex"),
      provider: reader.provider,
      path: reader.path,
      status: "ok",
      scannedFiles: 0,
      malformedRecords: 0,
    };
    const records: UsageRecord[] = [];
    try {
      if (reader.kind === "scan" && reader.provider === "cursor") {
        try {
          records.push(
            ...(await this.cursor.read(sinceMs, untilMs, keychain, refresh)),
          );
          source.scannedFiles = 1;
          const account = records[0]?.dedupeKey?.split(":")[1];
          if (account) source.id = `cursor:${account}`;
        } catch (error) {
          source.status = "failed";
          source.message =
            error instanceof Error &&
            /^(Enable Cursor|Sign in to Cursor)/.test(error.message)
              ? error.message
              : "Cursor account usage could not be read.";
        }
      } else {
        const info = await stat(reader.path);
        if (!info.isDirectory()) throw new Error("Not a directory");
        if (reader.kind === "scan" && reader.provider !== "cursor") {
          const result = await scanUsageDatabase(
            reader.path,
            reader.provider,
            this.databases,
          );
          records.push(...result.records);
          source.scannedFiles = result.files;
          if (result.failed) source.status = "partial";
        } else if (reader.kind === "transcripts") {
          for await (const path of usageFiles(reader.path, (name) =>
            reader.fileName
              ? name === reader.fileName
              : name.endsWith(".jsonl"),
          )) {
            try {
              const resolved = await canonical(path);
              if (seenFiles.has(resolved)) continue;
              seenFiles.add(resolved);
              const data = await this.transcripts.read(
                resolved,
                formats[reader.provider],
              );
              source.scannedFiles++;
              source.malformedRecords += data.malformed;
              // Codex rollouts may survive in multiple directories. Timestamp + normalized
              // request identity preserves distinct same-session requests across files.
              for (const record of data.records)
                records.push(
                  record.provider === "codex" && record.sessionId
                    ? {
                        ...record,
                        dedupeKey: JSON.stringify([
                          "codex",
                          record.sessionId,
                          record.timestampMs,
                          record.model,
                          record.totals,
                        ]),
                      }
                    : record,
                );
            } catch {
              source.status = "partial";
            }
          }
        }
      }
    } catch (error) {
      source.status =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "partial";
    }
    if (source.status === "partial")
      source.message = "Some usage history could not be read.";
    return { source, records };
  }
}
export const usageProviderName = (provider: UsageProvider) =>
  ({
    claude: "Claude",
    codex: "Codex",
    grok: "Grok",
    pi: "Pi",
    omp: "OMP",
    opencode: "OpenCode",
    antigravity: "Antigravity",
    cursor: "Cursor",
  })[provider];
