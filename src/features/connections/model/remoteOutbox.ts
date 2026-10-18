import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

/** Commands awaiting a Host receipt, keyed like the earlier localStorage entries.
 * Rows live in the native session database so WebView quota cannot block a
 * send; this mirror keeps lookups synchronous for render paths. */
export const OUTBOX_PREFIX = "monocode.remote-command.v1:";
const CHANGED = "monocode://remote-outbox";
const entries = new Map<string, string>();
type Change = { source: string; key: string; entry: string | null };
// Each window applies its own changes synchronously and ignores their echo.
const source = crypto.randomUUID();
let listening: Promise<unknown> | undefined;
// Native commands may run concurrently; serializing keeps a delete from
// overtaking the put it follows.
let writes: Promise<unknown> = Promise.resolve();
const queued = <T>(write: () => Promise<T>): Promise<T> => {
  const next = writes.then(write, write);
  writes = next.catch(() => undefined);
  return next;
};
const announce = (key: string, entry: string | null) =>
  void emit(CHANGED, { source, key, entry } satisfies Change).catch(() => undefined);

/** Loads native rows and moves requests saved by earlier desktop builds. */
export async function loadRemoteOutbox(): Promise<void> {
  listening ??= listen<Change>(CHANGED, ({ payload }) => {
    if (payload.source === source) return;
    if (payload.entry === null) entries.delete(payload.key);
    else entries.set(payload.key, payload.entry);
  }).catch(() => undefined);
  const rows = await invoke<[string, string][]>("remote_outbox_list");
  entries.clear();
  for (const [key, entry] of rows) entries.set(key, entry);
  const legacy: [string, string][] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      const entry = key?.startsWith(OUTBOX_PREFIX) ? localStorage.getItem(key) : null;
      if (key && entry !== null) legacy.push([key, entry]);
    }
  } catch {
    return;
  }
  for (const [key, entry] of legacy) {
    if (!entries.has(key)) {
      // An unmovable request stays recoverable from WebView storage.
      entries.set(key, entry);
      try {
        await queued(() => invoke("remote_outbox_put", { key, entry }));
      } catch {
        continue;
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* The native row is authoritative; a leftover copy is ignored. */
    }
  }
}

export const outboxKeys = () => [...entries.keys()];
export const outboxEntry = (key: string) => entries.get(key);

/** Resolves only after the request is durable; callers dispatch afterwards. */
export async function putOutboxEntry(key: string, entry: string): Promise<void> {
  await queued(() => invoke("remote_outbox_put", { key, entry }));
  entries.set(key, entry);
  announce(key, entry);
}

export function deleteOutboxEntries(keys: string[]): Promise<void> {
  for (const key of keys) {
    entries.delete(key);
    announce(key, null);
  }
  // A failed delete only leaves a request the Host deduplicates by ID.
  return queued(() => invoke("remote_outbox_delete", { keys })).then(
    () => undefined,
    () => undefined,
  );
}
