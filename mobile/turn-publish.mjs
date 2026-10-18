import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./task-publish.mjs";
import { config } from "./update-server.mjs";

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function runPublish(root, fingerprint, logPath) {
  const log = openSync(logPath, "w");
  try {
    execFileSync(
      "bash",
      [
        join(root, "mobile/task-publish.sh"),
        "--expected-fingerprint",
        fingerprint,
      ],
      {
        cwd: root,
        stdio: ["ignore", log, log],
      },
    );
  } catch {
    throw new Error(`Mobile build/publication failed. See ${logPath}`);
  } finally {
    closeSync(log);
  }
  const state = await readState(
    join(root, "build/mobile-publish/last-success.json"),
  );
  return `Mobile build ${state.versionCode}: ${config.baseUrl}/apk/monocode-${state.versionCode}.apk`;
}

export async function handleTurn(
  event,
  { root, publish = runPublish, expectedFingerprint },
) {
  if (!event.session_id || !event.turn_id) return {};
  const key = createHash("sha256")
    .update(JSON.stringify([event.session_id, event.turn_id]))
    .digest("hex");
  const directory = join(root, "build/mobile-publish/turns");
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
  const state = await readState(stateFile);
  // Consume once, including failures. Never create a continuation/retry loop.
  await rm(stateFile, { force: true });
  if (!state || event.permission_mode === "plan") return {};
  const fingerprint = expectedFingerprint ?? (await sourceFingerprint(root));
  if (fingerprint === state.fingerprint) return {};
  const result = await publish(
    root,
    fingerprint,
    join(directory, `${key}.log`),
  );
  return { systemMessage: result };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    console.log(JSON.stringify(await handleTurn(JSON.parse(input), { root })));
  } catch (error) {
    // Stop accepts JSON only. Surface the failure without restarting the agent.
    console.log(JSON.stringify({ systemMessage: error.message }));
  }
}
