import type {
  BotHistory,
  BotHistoryCursor,
  BotMessage,
  BotMessages,
  BotConfiguration,
} from "./botView";
import type { RemoteAttachment } from "../../connections/model/protocol";
export type BotRpc = <T>(method: string, params?: object) => Promise<T>;
type BotSync = {
  assistant: BotConfiguration | null;
  messages: BotMessage[];
};
export function mergeBotMessages(
  previous: BotMessage[],
  incoming: BotMessage[],
): BotMessage[] {
  if (!incoming.length) return previous;
  const entries = new Map(previous.map((m) => [m.id, m]));
  let changed = false;
  for (const message of incoming)
    if ((entries.get(message.id)?.revision ?? -1) < message.revision) {
      entries.set(message.id, message);
      changed = true;
    }
  if (!changed) return previous;
  return [...entries.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}
export class BotClient {
  private revision = 0;
  private entries: BotMessage[] = [];
  private syncMode?: "history" | "incremental";
  private historySupported = false;
  private historyCursor?: BotHistoryCursor;
  private olderHistory = false;
  private historyIds = new Set<string>();
  private syncing?: Promise<BotSync>;
  private loadingHistory?: Promise<BotMessage[]>;
  private outbox?: {
    commandId: string;
    text: string;
    attachments: RemoteAttachment[];
  };
  constructor(
    readonly hostKey: string,
    readonly rpc: BotRpc,
    private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    initialRevision = 0,
  ) {
    this.revision = initialRevision;
  }
  get hasOlderHistory() { return this.olderHistory; }
  get historyMessageIds(): ReadonlySet<string> { return this.historyIds; }
  sync({ history = this.historySupported, fresh = false } = {}): Promise<BotSync> {
    this.historySupported = history;
    // A mutation needs a read that starts after its receipt, even when an
    // earlier poll is still in flight.
    if (fresh && this.syncing)
      return this.syncing.then(
        () => this.sync({ history, fresh }),
        () => this.sync({ history, fresh }),
      );
    // Share overlapping polls so an older response cannot roll the cursor backwards.
    return this.syncing ??= this.syncMessages(history).finally(() => {
      this.syncing = undefined;
    });
  }
  private async syncMessages(history: boolean): Promise<BotSync> {
    if (history && !this.syncMode) {
      const page = await this.rpc<BotHistory>("assistant.messages", {
        latest: true,
        limit: 30,
      });
      this.entries = mergeBotMessages([], page.entries);
      this.revision = page.assistant?.chatRevision ?? 0;
      this.historyCursor = page.nextCursor;
      this.olderHistory = page.hasMore;
      this.historyIds = new Set(page.entries.map((message) => message.id));
      this.syncMode = page.assistant ? "history" : undefined;
      return { assistant: page.assistant, messages: this.entries };
    }
    const assistant = await this.rpc<BotConfiguration | null>("assistant.get");
    if (!assistant) {
      this.entries = [];
      this.revision = 0;
      this.syncMode = undefined;
      this.olderHistory = false;
      this.historyCursor = undefined;
      this.historyIds.clear();
      return { assistant, messages: this.entries };
    }
    if (this.syncMode === "history" && assistant.chatRevision === this.revision)
      return { assistant, messages: this.entries };
    let page: BotMessages;
    do {
      page = await this.rpc<BotMessages>("assistant.messages", {
        afterRevision: this.revision,
        limit: 100,
      });
      this.entries = mergeBotMessages(this.entries, page.entries);
      this.revision = page.nextRevision;
    } while (page.hasMore);
    this.syncMode ??= "incremental";
    return { assistant, messages: this.entries };
  }
  loadOlder(): Promise<BotMessage[]> {
    if (this.loadingHistory) return this.loadingHistory;
    if (!this.olderHistory || !this.historyCursor)
      return Promise.resolve(this.entries);
    this.loadingHistory = this.rpc<BotHistory>("assistant.messages", {
      latest: true,
      before: this.historyCursor,
      limit: 30,
    }).then((page) => {
      // Delta polling may have updated a card while its older page was in flight.
      this.entries = mergeBotMessages(this.entries, page.entries);
      for (const message of page.entries) this.historyIds.add(message.id);
      this.historyCursor = page.nextCursor;
      this.olderHistory = page.hasMore;
      return this.entries;
    }).finally(() => {
      this.loadingHistory = undefined;
    });
    return this.loadingHistory;
  }
  pending() {
    const key = `monocode.assistant-outbox:${this.hostKey}`;
    if (!this.outbox)
      try {
        const raw = this.storage?.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw);
          if (
            typeof saved.commandId === "string" &&
            typeof saved.text === "string"
          )
            this.outbox = { ...saved, attachments: saved.attachments ?? [] };
        }
      } catch {
        /* The in-memory attempt remains retryable. */
      }
    return this.outbox;
  }
  async send(
    text: string,
    attachments: RemoteAttachment[] = [],
  ): Promise<unknown> {
    const key = `monocode.assistant-outbox:${this.hostKey}`;
    const pending = this.pending();
    if (
      pending &&
      (pending.text !== text ||
        JSON.stringify(pending.attachments) !== JSON.stringify(attachments))
    )
      throw new Error("A previous assistant message needs retrying first.");
    const command = pending ?? {
      commandId: crypto.randomUUID(),
      text,
      attachments,
    };
    this.outbox = command;
    try {
      this.storage?.setItem(key, JSON.stringify(command));
    } catch {
      /* The same call still uses one stable ID. */
    }
    const receipt = await this.rpc("assistant.send", command);
    this.outbox = undefined;
    try {
      this.storage?.removeItem(key);
    } catch {
      /* Replaying the saved ID is safe. */
    }
    return receipt;
  }
  async upload(file: File): Promise<RemoteAttachment> {
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Attachments must be at most 20 MB");
    const ref: RemoteAttachment = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      kind: file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : "file",
    };
    for (let offset = 0; offset < file.size || offset === 0;) {
      const bytes = new Uint8Array(
        await file.slice(offset, offset + 512 * 1024).arrayBuffer(),
      );
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const next = await this.rpc<{ offset: number }>("attachments.upload", {
        id: ref.id,
        offset,
        size: ref.size,
        data: btoa(binary),
      });
      if (next.offset !== offset + bytes.length)
        throw new Error("Attachment upload was incomplete");
      offset = next.offset;
      if (!file.size) break;
    }
    return ref;
  }
  readImage(messageId: string, file: RemoteAttachment): Promise<string> {
    if (file.kind !== "image") return Promise.reject(new Error("Invalid image transfer"));
    return this.readAttachment(messageId, file);
  }

  /** Base64 bytes of an attachment kept with a public assistant message. */
  async readAttachment(messageId: string, file: RemoteAttachment): Promise<string> {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 20 * 1024 * 1024)
      throw new Error("Invalid image transfer");
    const pieces: string[] = [];
    let offset = 0;
    while (offset < file.size) {
      const chunk = await this.rpc<{ data: string; offset: number; size: number }>("attachments.read", {
        messageId, id: file.id, offset,
      });
      if (chunk.size !== file.size || chunk.offset <= offset || chunk.offset > file.size ||
          atob(chunk.data).length !== chunk.offset - offset ||
          (chunk.offset < file.size && (chunk.offset - offset) % 3 !== 0))
        throw new Error("Invalid image transfer");
      pieces.push(chunk.data);
      offset = chunk.offset;
    }
    return pieces.join("");
  }
}
