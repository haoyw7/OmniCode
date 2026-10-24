import type { CommandReceipt, HostCommand } from "../contracts/protocol";
import type { OutboxStoragePort } from "./ports";

export type PendingCommandEntry = { command: HostCommand };
export type CommandJournal<Entry extends PendingCommandEntry> = {
  read(): Promise<Entry | undefined>;
  write(entry: Entry): Promise<void>;
  clear(): Promise<void>;
};

/** A durable command slot. Native secure storage reads are cached, failures are
 * retryable, and a failed write never enters the acknowledged in-memory state. */
export class StoredCommandJournal<Entry extends PendingCommandEntry, Key extends string = string> implements CommandJournal<Entry> {
  private value?: Promise<string | null>;

  constructor(private readonly storage: OutboxStoragePort<Key>, private readonly key: Key,
    private readonly decode: (value: string) => Entry = JSON.parse) {}

  invalidate(): void { this.value = undefined; }

  async read(): Promise<Entry | undefined> {
    const pending = this.value ??= this.storage.get(this.key);
    try {
      const value = await pending;
      return value === null ? undefined : this.decode(value);
    } catch (error) {
      if (this.value === pending) this.invalidate();
      throw error;
    }
  }

  async write(entry: Entry): Promise<void> {
    const value = JSON.stringify(entry);
    this.invalidate();
    await this.storage.set(this.key, value);
    this.value = Promise.resolve(value);
  }

  async clear(): Promise<void> {
    this.invalidate();
    await this.storage.remove(this.key);
    this.value = Promise.resolve(null);
  }
}

/** Acknowledgement and first-message replay semantics are identical on every platform. */
export async function flushCommandOutbox<Entry extends PendingCommandEntry>(options: {
  journal: CommandJournal<Entry>;
  dispatch(command: HostCommand): Promise<CommandReceipt>;
  validate(entry: Entry): void;
  next?(entry: Entry, receipt: CommandReceipt): Entry | undefined;
  /** A UI may need to show the created session before sending its durable first message. */
  deferFollowup?: boolean;
  definitiveRejection(error: unknown): boolean;
}): Promise<CommandReceipt> {
  const { journal } = options;
  try {
    const saved = await journal.read();
    if (!saved) throw new Error("No pending request.");
    let entry: Entry = saved;
    options.validate(entry);
    while (true) {
      const receipt = await options.dispatch(entry.command);
      const next: Entry | undefined = options.next?.(entry, receipt);
      if (!next) {
        await journal.clear();
        return receipt;
      }
      // Persist the receipt-derived follow-up before dispatch. A lost response
      // or restart retries its exact command id rather than sending twice.
      await journal.write(next);
      if (options.deferFollowup) return receipt;
      entry = next;
      options.validate(entry);
    }
  } catch (error) {
    if (options.definitiveRejection(error)) await journal.clear();
    throw error;
  }
}

/** Unknown capabilities reject once; ambiguous network failures remain replayable. */
export function isDefinitiveCommandRejection(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error && error.status === 400) return true;
  const text = error instanceof Error ? error.message : String(error);
  return /Host rejected request:|Unsupported (host method|remote operation|command)|Unknown command|command.?id.*(different|mismatch|conflict)/i.test(text);
}
