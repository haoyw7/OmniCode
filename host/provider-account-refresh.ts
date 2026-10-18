import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCodexAccountRequest } from "../src/integrations/harness/providers/codex/codexAccountRequest";
import { localMachineIO, withMachineIO } from "./machine-io";
import { withProviderAccountLock } from "./provider-account-lock";

const REFRESH_WINDOW_MS = 10 * 60_000;
const MAX_AUTH_BYTES = 1024 * 1024;

/** Expiry is only a scheduling hint; the provider still validates the credential. */
function expiresSoon(auth: unknown, now: number): boolean {
  if (!auth || typeof auth !== "object") return false;
  const value = auth as Record<string, unknown>;
  if (value.auth_mode !== undefined && value.auth_mode !== "chatgpt") return false;
  if (!value.tokens || typeof value.tokens !== "object") return false;
  const tokens = value.tokens as Record<string, unknown>;
  if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token || typeof tokens.access_token !== "string") return false;
  const parts = tokens.access_token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp > 0 &&
      payload.exp * 1000 < now + REFRESH_WINDOW_MS;
  } catch { return false; }
}

/** Uses the desktop app-server's account endpoint without creating an inference turn. */
export async function refreshCodexAccountBeforeWsl(input: {
  command: string;
  home: string;
  accountId?: string;
}, dependencies: {
  now?: () => number;
  request?: (...args: Parameters<typeof runCodexAccountRequest>) => Promise<unknown>;
} = {}): Promise<"not-needed" | "refreshed"> {
  return withProviderAccountLock(`codex:${input.home}`, async () => {
    const file = join(input.home, "auth.json");
    let auth: unknown;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_AUTH_BYTES) return "not-needed";
      auth = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return "not-needed";
      throw new Error("Unable to read the desktop Codex account before starting WSL");
    }
    if (!expiresSoon(auth, (dependencies.now ?? Date.now)())) return "not-needed";
    try {
      await withMachineIO(localMachineIO, () => (dependencies.request ?? runCodexAccountRequest)(
        input.command, homedir(), "account/read", { refreshToken: true }, input.accountId ?? "default",
        `monocode-codex-refresh-${randomUUID()}`,
      ));
    } catch {
      // CLI errors may include credential contents; expose only app-owned copy.
      throw new Error("Unable to refresh the desktop Codex account before starting WSL");
    }
    return "refreshed";
  });
}
