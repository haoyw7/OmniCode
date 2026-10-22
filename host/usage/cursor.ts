import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { parseCursorUsageEvent } from "../../src/integrations/harness/providers/cursor/cursorUsage";
import {
  usageObject as object,
  type UsageRecord,
} from "../../src/integrations/harness/core/usage";
import { usageJson } from "./http";

let pendingKeychain: Promise<string | undefined> | undefined;
export async function cursorToken(
  keychainEnabled: boolean,
): Promise<string | undefined> {
  if (process.env.CURSOR_AUTH_TOKEN)
    return process.env.CURSOR_AUTH_TOKEN.trim();
  if (
    process.env.CURSOR_API_KEY ||
    process.env.AGENT_CLI_CREDENTIAL_STORE === "memory"
  )
    return;
  if (
    process.platform === "darwin" &&
    process.env.AGENT_CLI_CREDENTIAL_STORE !== "file"
  ) {
    if (!keychainEnabled || process.env.CURSOR_API_ENDPOINT) return;
    pendingKeychain ??= new Promise<string | undefined>((resolve) => {
      execFile(
        "security",
        [
          "find-generic-password",
          "-s",
          "cursor-access-token",
          "-a",
          "cursor-user",
          "-w",
        ],
        { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
        (error, stdout) => resolve(error ? undefined : stdout.trim()),
      );
    }).finally(() => {
      pendingKeychain = undefined;
    });
    return pendingKeychain;
  }
  const home = homedir();
  const path =
    process.platform === "win32"
      ? join(
          process.env.APPDATA || join(home, "AppData", "Roaming"),
          "Cursor",
          "auth.json",
        )
      : process.platform === "darwin"
        ? join(home, ".cursor", "auth.json")
        : join(
            process.env.XDG_CONFIG_HOME || join(home, ".config"),
            "cursor",
            "auth.json",
          );
  try {
    const token = object(JSON.parse(await readFile(path, "utf8"))).accessToken;
    return typeof token === "string" ? token : undefined;
  } catch {
    return;
  }
}
export function cursorAccountKey(token: string): string | undefined {
  try {
    const subject = object(
      JSON.parse(
        Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"),
      ),
    ).sub;
    return typeof subject === "string" && subject
      ? createHash("sha256").update(subject).digest("hex")
      : undefined;
  } catch {
    return undefined;
  }
}
const canonicalJson = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
          .join(",")}}`
      : (JSON.stringify(value) ?? "null");
function overlap(previous: string[], current: string[]) {
  const sequence = [...current, "", ...previous],
    lengths = sequence.map(() => 0);
  for (let index = 1; index < sequence.length; index++) {
    let length = lengths[index - 1];
    while (length > 0 && sequence[index] !== sequence[length])
      length = lengths[length - 1];
    if (sequence[index] === sequence[length]) length++;
    lengths[index] = length;
  }
  return lengths.at(-1) ?? 0;
}
export class CursorUsageReader {
  private cached?: {
    account: string;
    start: number;
    end: number;
    at: number;
    records: UsageRecord[];
  };
  async read(
    sinceMs: number,
    untilMs: number,
    keychainEnabled: boolean,
    refresh = false,
  ): Promise<UsageRecord[]> {
    const token = await cursorToken(keychainEnabled);
    if (!token)
      throw new Error(
        process.platform === "darwin" && !keychainEnabled
          ? "Enable Cursor Keychain access to read account usage."
          : "Sign in to Cursor CLI to read account usage.",
      );
    const account = cursorAccountKey(token);
    const subject = account
      ? object(
          JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
          ),
        ).sub
      : undefined;
    if (!account || typeof subject !== "string")
      throw new Error("Sign in to Cursor CLI to read account usage.");
    const old = this.cached;
    if (
      !refresh &&
      old?.account === account &&
      old.start <= sinceMs &&
      old.end >= untilMs - 300_000 &&
      Date.now() - old.at < 300_000
    )
      return old.records;
    const pages: unknown[][] = [];
    let total: number | undefined;
    const deadline = Date.now() + 55_000;
    for (let page = 1; ; page++) {
      if (
        Date.now() > deadline ||
        page > (total === undefined ? 1000 : Math.ceil(total / 1000) * 2 + 1)
      )
        throw new Error("Cursor usage request timed out");
      const body = await usageJson(
        "https://cursor.com/api/dashboard/get-filtered-usage-events",
        {
          method: "POST",
          headers: {
            Origin: "https://cursor.com",
            "Content-Type": "application/json",
            Cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${subject.split("|").at(-1)}::${token}`)}`,
          },
          body: JSON.stringify({
            page,
            pageSize: 1000,
            startDate: String(sinceMs),
            endDate: String(untilMs),
          }),
        },
      );
      const count = Object.keys(body).length ? body.totalUsageEventsCount : 0;
      const events =
        body.usageEventsDisplay ??
        (Object.keys(body).every((key) => key === "totalUsageEventsCount")
          ? []
          : undefined);
      if (
        "error" in body ||
        "message" in body ||
        "code" in body ||
        !Array.isArray(events) ||
        events.length > 1000 ||
        (count !== undefined &&
          (!Number.isSafeInteger(count) ||
            Number(count) < 0 ||
            (total !== undefined && count !== total)))
      )
        throw new Error("Invalid Cursor account usage page");
      if (typeof count === "number") total = count;
      pages.push(events);
      if (events.length < 1000) break;
    }
    let removals =
      total === undefined
        ? 0
        : pages.reduce((sum, page) => sum + page.length, 0) - total;
    if (removals < 0) throw new Error("Incomplete Cursor account usage pages");
    let previous: string[] = [];
    const occurrences = new Map<string, number>(),
      records: UsageRecord[] = [];
    for (const page of pages) {
      const keys = page.map(canonicalJson),
        remove = Math.min(removals, overlap(previous, keys));
      removals -= remove;
      previous = keys;
      for (const event of page.slice(remove)) {
        const record = parseCursorUsageEvent(event, account, occurrences);
        if (
          record &&
          record.timestampMs >= sinceMs &&
          record.timestampMs <= untilMs
        )
          records.push(record);
      }
    }
    if (removals !== 0)
      throw new Error("Inconsistent Cursor account usage boundaries");
    this.cached = {
      account,
      start: sinceMs,
      end: untilMs,
      at: Date.now(),
      records,
    };
    return records;
  }
}
