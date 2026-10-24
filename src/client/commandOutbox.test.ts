import { expect, it, vi } from "vitest";
import type { CommandReceipt, HostCommand } from "../contracts/protocol";
import { flushCommandOutbox, isDefinitiveCommandRejection, StoredCommandJournal } from "./commandOutbox";

const command: HostCommand = { type: "send", commandId: "original", sessionId: "session", text: "hello" };
const receipt = { commandId: "original", sessionId: "session", revision: 2 } as CommandReceipt;
function storage() {
  const values = new Map<string, string>();
  return { get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    remove: vi.fn(async (key: string) => { values.delete(key); }) };
}

it("replays an ambiguously accepted command with its exact id after restart", async () => {
  const port = storage();
  const journal = new StoredCommandJournal(port, "pending");
  await journal.write({ command });
  const dispatch = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(receipt);
  const run = (slot: typeof journal) => flushCommandOutbox({ journal: slot, dispatch, validate: () => {}, definitiveRejection: isDefinitiveCommandRejection });
  await expect(run(journal)).rejects.toThrow("connection lost");
  await run(new StoredCommandJournal(port, "pending"));
  expect(dispatch.mock.calls.map(([value]) => value)).toEqual([command, command]);
  expect(await new StoredCommandJournal(port, "pending").read()).toBeUndefined();
});

it.each(["Unsupported host method", "Unsupported command", "Command ID was already used with a different payload"])("does not indefinitely retry a definitive rejection: %s", async (message) => {
  const journal = new StoredCommandJournal(storage(), "pending");
  await journal.write({ command });
  const dispatch = vi.fn().mockRejectedValue(new Error(message));
  await expect(flushCommandOutbox({ journal, dispatch, validate: () => {}, definitiveRejection: isDefinitiveCommandRejection })).rejects.toThrow(message);
  expect(await journal.read()).toBeUndefined();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("does not acknowledge a failed durable write and retries failed storage reads", async () => {
  const port = storage();
  port.get.mockRejectedValueOnce(new Error("locked"));
  const journal = new StoredCommandJournal(port, "pending");
  await expect(journal.read()).rejects.toThrow("locked");
  expect(await journal.read()).toBeUndefined();
  port.set.mockRejectedValueOnce(new Error("disk full"));
  await expect(journal.write({ command })).rejects.toThrow("disk full");
  expect(await journal.read()).toBeUndefined();
});
