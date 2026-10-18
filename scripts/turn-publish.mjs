import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleTurn as mobile } from "../mobile/turn-publish.mjs";
import { handleTurn as desktop } from "./desktop-turn-publish.mjs";
import { sourceFingerprint as mobileFingerprint } from "../mobile/task-publish.mjs";
import { sourceFingerprint as desktopFingerprint } from "./desktop-task-publish.mjs";

const targets = [
  { handle: mobile, fingerprint: mobileFingerprint },
  { handle: desktop, fingerprint: desktopFingerprint },
];

// Keep both builds sequential; a mobile failure must not discard desktop state.
export async function handleTurn(event, { root, handlers = targets }) {
  const messages = [];
  // Snapshot both targets before either build begins. Edits during the mobile
  // build must not become part of a supposedly completed desktop turn.
  const snapshots =
    event.hook_event_name === "Stop"
      ? await Promise.all(handlers.map((target) => target.fingerprint?.(root)))
      : [];
  for (const [index, { handle }] of handlers.entries()) {
    try {
      const result = await handle(event, {
        root,
        expectedFingerprint: snapshots[index],
      });
      if (result.systemMessage) messages.push(result.systemMessage);
    } catch (error) {
      messages.push(error.message);
    }
  }
  return messages.length ? { systemMessage: messages.join("\n") } : {};
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const root = fileURLToPath(new URL("../", import.meta.url));
    console.log(JSON.stringify(await handleTurn(JSON.parse(input), { root })));
  } catch (error) {
    console.log(JSON.stringify({ systemMessage: error.message }));
  }
}
