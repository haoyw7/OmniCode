import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, sourceFingerprint } from "./desktop-task-publish.mjs";

async function runPublish(root, fingerprint, logPath) {
  const log = openSync(logPath, "w");
  try {
    execFileSync(
      "bash",
      [
        join(root, "scripts/desktop-task-publish.sh"),
        "--expected-fingerprint",
        fingerprint,
      ],
      {
        cwd: root,
        stdio: ["ignore", log, log],
      },
    );
  } catch {
    throw new Error(`Desktop build/publication failed. See ${logPath}`);
  } finally {
    closeSync(log);
  }
  const state = await readJson(
    join(root, "build/desktop-publish/last-success.json"),
  );
  return `Desktop ${state.manifest.version}:\nLinux: ${state.manifest.platforms["linux-x86_64-deb"].url}\nWindows: ${state.manifest.platforms["windows-x86_64-nsis"].url}`;
}

export async function handleTurn(
  event,
  { root, publish = runPublish, expectedFingerprint },
) {
  if (!event.session_id || !event.turn_id) return {};
  const key = createHash("sha256")
    .update(JSON.stringify([event.session_id, event.turn_id]))
    .digest("hex");
  const directory = join(root, "build/desktop-publish/turns");
  const stateFile = join(directory, `${key}.json`);
  if (event.hook_event_name === "UserPromptSubmit") {
    if (event.permission_mode === "plan") return {};
    await mkdir(directory, { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({ fingerprint: await sourceFingerprint(root) }),
    );
    return {};
  }
  if (event.hook_event_name === "Interrupt") {
    await rm(stateFile, { force: true });
    return {};
  }
  if (event.hook_event_name !== "Stop") return {};
  const state = await readJson(stateFile);
  // Consume once, even on failure; never request an automatic continuation.
  await rm(stateFile, { force: true });
  if (!state || event.permission_mode === "plan") return {};
  const fingerprint = expectedFingerprint ?? (await sourceFingerprint(root));
  if (fingerprint === state.fingerprint) return {};
  return {
    systemMessage: await publish(
      root,
      fingerprint,
      join(directory, `${key}.log`),
    ),
  };
}
