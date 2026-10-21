import type { BotMessage } from "./botView";
import { createStore } from "zustand/vanilla";
import { devicePreferences } from "../../../shared/lib/persistedPreferences";

const PREFIX = "omnicode.assistant-read:";
const readMarks = createStore(() => ({ revision: 0, fallback: {} as Record<string, number> }));
let subscriptions = 0;

export function botReadRevision(hostKey: string): number {
  try {
    const value = Number(devicePreferences.getItem(PREFIX + hostKey));
    return Math.max(
      Number.isFinite(value) ? value : 0,
      readMarks.getState().fallback[hostKey] ?? 0,
    );
  } catch {
    return readMarks.getState().fallback[hostKey] ?? 0;
  }
}

export function markBotRead(
  hostKey: string,
  messages: BotMessage[],
) {
  const revision = messages.reduce(
    (max, message) => Math.max(max, message.revision),
    0,
  );
  if (revision <= botReadRevision(hostKey)) return;
  try {
    devicePreferences.setItem(PREFIX + hostKey, String(revision));
  } catch {
    // Keep read state usable when storage is unavailable.
    readMarks.setState(state => ({ fallback: { ...state.fallback, [hostKey]: revision }, revision: state.revision + 1 }));
    return;
  }
  readMarks.setState(state => ({ revision: state.revision + 1 }));
}

function storage(event: StorageEvent) {
  if (event.key === null || event.key.startsWith(PREFIX)) readMarks.setState(state => ({ revision: state.revision + 1 }));
}
export function subscribeBotRead(listener: () => void) {
  if (subscriptions++ === 0) window.addEventListener("storage", storage);
  const stop = readMarks.subscribe(listener);
  return () => {
    stop();
    if (--subscriptions === 0) window.removeEventListener("storage", storage);
  };
}

export function unreadBotMessages(
  hostKey: string,
  messages: BotMessage[],
) {
  const readRevision = botReadRevision(hostKey);
  return messages.filter(
    (message) =>
      message.revision > readRevision &&
      ((message.kind === "assistant" && !!message.text.trim()) ||
        (message.kind === "input" && !message.resolved)),
  );
}
