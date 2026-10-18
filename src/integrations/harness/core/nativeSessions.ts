import { translate } from "../../../shared/i18n/language";
import type { Block } from "../../../features/sessions/model/session";

export type NativeSessionProvider =
  | "codex"
  | "pi"
  | "claude"
  | "omp"
  | "opencode";
export const NATIVE_SESSION_PROVIDERS: readonly NativeSessionProvider[] = [
  "claude",
  "codex",
  "pi",
  "omp",
  "opencode",
];
export const nativeProviderLabel = (provider: NativeSessionProvider): string =>
  ({
    claude: "Claude Code",
    codex: "Codex",
    pi: "Pi",
    omp: "omp",
    opencode: "OpenCode",
  })[provider];

export type NativeSessionFile = {
  provider: NativeSessionProvider;
  providerSessionId: string;
  cwd: string;
  /** JSONL transcript, or the shared database for `storage: "sqlite"`. */
  path: string;
  revision: string;
  modifiedAt: number;
  /** Absent in records listed before multi-provider sync. */
  storage?: "jsonl" | "sqlite";
  /** OmniCode provider account whose config directory owns the session. */
  accountId?: string;
  /** Title the agent generated or the user set in its CLI, when stored outside the transcript. */
  title?: string;
  /** First prompt, for lists only; never used as the conversation title. */
  preview?: string;
  /** Opaque Host-issued identity when the Host listed this source. */
  sourceId?: string;
};

/** A shared database holds many conversations, so the path alone is not an identity. */
export const nativeSourceKey = (
  file: Pick<NativeSessionFile, "path" | "providerSessionId" | "storage">,
): string =>
  file.storage === "sqlite" ? `${file.path}#${file.providerSessionId}` : file.path;


export type NativeTranscript = {
  createdAt: number;
  blocks: Block[];
  model?: string;
  modelSettings: Record<string, string>;
  title?: string;
};

type RecordValue = Record<string, unknown>;
export const nativeRecord = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
export const nativeString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Only an unfinished last line may be ignored; corruption must never replace saved history. */
export function nativeJsonLines(content: string): RecordValue[] {
  const lines = content.split("\n");
  const records: RecordValue[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      records.push(nativeRecord(JSON.parse(line)));
    } catch {
      if (index === lines.length - 1 && !content.endsWith("\n")) break;
      throw new Error(
        translate("Invalid native session JSON at line {line}", {
          line: index + 1,
        }),
      );
    }
  }
  return records;
}

/** Read textual blocks without ever rendering embedded image/base64 data. */
export function nativeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const item = nativeRecord(part);
      if (
        ["image", "image_url", "input_image", "output_image"].includes(
          nativeString(item.type),
        )
      )
        return [translate("[Image retained in the native session]")];
      return ["text", "input_text", "output_text", "summary_text"].includes(
        nativeString(item.type),
      ) && typeof item.text === "string"
        ? [item.text]
        : [];
    })
    .join("\n");
}

export type NativeSessionHolder = {
  pid: number;
  command: string;
  provider: NativeSessionProvider;
};

export type NativeSessionAccess = {
  state: "idle" | "external" | "unknown" | "checking";
  reason: string;
  checkedAt: number;
  path: string;
  /** External CLI process that keeps the session read-only (Linux only). */
  holder?: NativeSessionHolder;
};


/** Host-managed native history synchronization, separate from ownership access. */
export type NativeSyncStatus = {
  state: "ready" | "syncing" | "error";
  /** Machine code: `sourceMissing`, `sourceAmbiguous`, `readFailed`, `parseFailed`, `persistFailed`, `bindingMismatch`, `diverged`, `deferred`. */
  reason?: string;
  /** Diagnostic text; provider and system values are preserved. */
  message?: string;
  /** Last source revision applied to history. */
  revision?: string;
  /** The source changed while the session was busy; settlement reads it. */
  pendingChange?: boolean;
  /** A Host turn wrote records that settlement has not absorbed yet. */
  hostTurn?: boolean;
  /** Next automatic retry while in `error`. */
  retryAt?: number;
  checkedAt: number;
};

/**
 * Identity recorded for a Host conversation started by OmniCode itself. It is
 * not a `nativeSession` link: warm process reuse continues until the source
 * changes outside a Host turn, which promotes the session to a managed link.
 */
export type NativeBinding = {
  provider: NativeSessionProvider;
  providerSessionId: string;
  accountId?: string;
  dataDir?: string;
  path?: string;
  storage?: "jsonl" | "sqlite";
  /** Source revision after the last Host turn. */
  hostRevision?: string;
};

/** One Host-resolved native source offered for import. */
export type NativeSourceSummary = NativeSessionFile & {
  sourceId: string;
  boundSessionId?: string;
};

export type NativeSourceListing = {
  sources: NativeSourceSummary[];
  warnings: string[];
  scannedAt: number;
  autoSync: boolean;
  /** Conversations the Host manages. */
  managedCount: number;
  /** Last successful synchronization of any managed conversation. */
  lastSyncedAt?: number;
};

const BLOCKING_SYNC = new Set(["diverged", "sourceMissing", "sourceAmbiguous", "bindingMismatch"]);

/** Host sync states that keep sending paused until the source or the user changes it. */
export const nativeSyncBlocked = (status: Pick<NativeSyncStatus, "state" | "reason"> | undefined): boolean =>
  status?.state === "error" && BLOCKING_SYNC.has(status.reason ?? "");

/** Localized explanation for a blocked Host-managed native conversation. */
export function nativeSyncNotice(status: Pick<NativeSyncStatus, "state" | "reason"> | undefined): string | undefined {
  if (!nativeSyncBlocked(status)) return undefined;
  if (status?.reason === "diverged")
    return translate(
      "The native conversation was rewound or switched branches outside OmniCode. History is kept; sending is paused.",
    );
  if (status?.reason === "sourceAmbiguous")
    return translate(
      "More than one native session file matches this conversation. Read-only until only one remains.",
    );
  return translate(
    "The native session file for this conversation is unavailable. Read-only until it returns.",
  );
}
