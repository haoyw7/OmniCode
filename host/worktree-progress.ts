import type { WorktreeProgress } from "../src/contracts/worktree";

const MAX_LINES = 2000;
const MAX_ENTRIES = 32;
const TTL_MS = 2 * 60_000;

/** Bounded live Git output for worktree creations, readable only by the device that started them. */
export class WorktreeCreationProgress {
  private entries = new Map<string, { lines: string[]; done: boolean; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private key(owner: string, id: unknown): string | undefined {
    return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? `${owner}:${id}` : undefined;
  }

  /** Returns a line sink, or undefined when the caller did not request live progress. */
  begin(owner: string, id: unknown): { line: (text: string) => void; finish: () => void } | undefined {
    if (id === undefined) return undefined;
    const key = this.key(owner, id);
    if (!key) throw new Error("Invalid worktree progress id");
    for (const [stale, entry] of this.entries) if (entry.expires < this.now()) this.entries.delete(stale);
    if (this.entries.has(key)) throw new Error("Worktree progress id is already in use");
    while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    const entry = { lines: [] as string[], done: false, expires: this.now() + TTL_MS };
    this.entries.set(key, entry);
    return {
      line: text => { if (!entry.done && entry.lines.length < MAX_LINES) entry.lines.push(text); entry.expires = this.now() + TTL_MS; },
      finish: () => { entry.done = true; entry.expires = this.now() + TTL_MS; },
    };
  }

  read(owner: string, id: unknown, offset: unknown): WorktreeProgress {
    const key = this.key(owner, id);
    if (!key) throw new Error("Invalid worktree progress id");
    if (offset !== undefined && (!Number.isSafeInteger(offset) || Number(offset) < 0)) throw new Error("Invalid worktree progress offset");
    const entry = this.entries.get(key);
    // A read can race the create request; an unknown id is simply not started yet.
    if (!entry || entry.expires < this.now()) return { lines: [], offset: Number(offset ?? 0), done: false };
    const start = Math.min(Number(offset ?? 0), entry.lines.length);
    return { lines: entry.lines.slice(start), offset: entry.lines.length, done: entry.done };
  }
}
