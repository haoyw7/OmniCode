import { usefulNativeTitle } from "../../../features/sessions/model/titlePolicy";
import type { HarnessEvent } from "./types";
import { AcpClient } from "./acp";
import { killChild, spawnChild, unwatchChild, watchChild } from "./child";
import type { HarnessId } from "../../../features/sessions/model/session";
import type { NativeTitleInput } from "./titleCoordinator";

export { parseClaudeNativeTitle } from "./nativeTitleParsing";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const listCapabilities = new WeakSet<AcpClient>();

export function noteAcpTitleCapabilities(
  acp: AcpClient,
  initialized: unknown,
): void {
  const capabilities = record(record(initialized).agentCapabilities);
  if (record(capabilities.sessionCapabilities).list != null)
    listCapabilities.add(acp);
}

export function nativeAcpTitleEvent(
  params: unknown,
  expectedSessionId: string,
): Extract<HarnessEvent, { type: "session.titleUpdated" }> | null {
  const outer = record(params);
  if (outer.sessionId != null && outer.sessionId !== expectedSessionId)
    return null;
  const update = record(outer.update ?? params);
  if (
    (update.sessionUpdate ?? update.session_update ?? update.type) !==
    "session_info_update"
  )
    return null;
  const title = usefulNativeTitle(update.title, expectedSessionId);
  return title
    ? {
        type: "session.titleUpdated",
        providerSessionId: expectedSessionId,
        title,
      }
    : null;
}

/** Only use the advertised read-only list method; never load/create a session. */
export async function readAcpSessionTitle(
  acp: AcpClient,
  providerSessionId: string,
  cwd: string,
  deadline = Date.now() + 5_000,
): Promise<string | null> {
  if (!listCapabilities.has(acp)) return null;
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const result = record(
      await acp.request(
        "session/list",
        { cwd, ...(cursor ? { cursor } : {}) },
        remaining,
      ),
    );
    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    const target = sessions
      .map(record)
      .find((s) => s.sessionId === providerSessionId);
    if (target) return usefulNativeTitle(target.title, providerSessionId);
    if (
      typeof result.nextCursor !== "string" ||
      !result.nextCursor ||
      seen.has(result.nextCursor)
    )
      return null;
    cursor = result.nextCursor;
    seen.add(cursor);
  }
  return null;
}

/** A parked/restored conversation can be listed without resuming its model. */
export async function readAcpTitleInProcess(
  input: NativeTitleInput,
  provider: HarnessId,
  binary: { path: string; args: string[] },
  spawnCwd = input.cwd,
): Promise<string | null> {
  const childId = `monocode-title-read-${crypto.randomUUID()}`;
  const acp = new AcpClient(childId, {});
  watchChild(
    childId,
    (line) => acp.pushLine(line),
    () => acp.close(),
  );
  const deadline = Date.now() + 5_000;
  try {
    await spawnChild(
      childId,
      binary.path,
      binary.args,
      spawnCwd,
      undefined,
      provider,
    );
    const init = await acp.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "monocode-title-read", version: "1" },
      },
      Math.max(1, deadline - Date.now()),
    );
    noteAcpTitleCapabilities(acp, init);
    if (Date.now() >= deadline) return null;
    return await readAcpSessionTitle(
      acp,
      input.providerSessionId,
      input.cwd,
      deadline,
    );
  } finally {
    acp.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => undefined);
  }
}
