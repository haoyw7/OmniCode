import type { NativeSessionProvider, NativeSessionFile, NativeSyncStatus } from "../../../contracts/session";


import { translate } from "../../../shared/i18n/language";

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

/** A shared database holds many conversations, so the path alone is not an identity. */
export const nativeSourceKey = (
  file: Pick<NativeSessionFile, "path" | "providerSessionId" | "storage">,
): string =>
  file.storage === "sqlite" ? `${file.path}#${file.providerSessionId}` : file.path;

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
