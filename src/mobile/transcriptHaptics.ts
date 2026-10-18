import type { Block } from "../features/sessions/model/session";

/** Baselines are reset at navigation/reconnect boundaries, not at every render. */
export class TranscriptHapticsTracker {
  private seen = new Map<string, string>();
  private initialized = false;
  private busy = false;
  private activity = false;
  private attention?: string;

  update(blocks: readonly Block[], busy: boolean, history: readonly { id: string; text: string }[] = [], attention?: string) {
    const result = { characters: 0, phase: false, attention: false, finished: false };
    if (!this.initialized) {
      for (const block of blocks) this.seen.set(block.id, block.text);
      this.initialized = true;
      this.busy = busy;
      this.attention = attention;
      return result;
    }
    for (const block of history) {
      const previous = this.seen.get(block.id);
      if (previous === undefined || block.text.length > previous.length)
        this.seen.set(block.id, block.text);
    }
    // Older turns may be paged in while the current one is streaming.
    const lastUser = blocks.reduce((last, block, index) => block.role === "user" ? index : last, -1);
    for (const [index, block] of blocks.entries()) {
      const previous = this.seen.get(block.id);
      if (index > lastUser && (busy || this.busy)) {
        if (block.role === "assistant" && block.text.startsWith(previous ?? ""))
          result.characters += Array.from(block.text.slice(previous?.length ?? 0)).length;
        if (previous === undefined && (block.role === "reasoning" || block.role === "tool"))
          result.phase = true;
      }
      // A transient shorter snapshot must not replay already consumed output.
      if (previous === undefined || block.text.length >= previous.length)
        this.seen.set(block.id, block.text);
    }
    if (result.characters || result.phase) this.activity = true;
    result.attention = !!attention && attention !== this.attention;
    result.finished = this.busy && !busy && this.activity && !attention;
    if (!busy) this.activity = false;
    this.busy = busy;
    this.attention = attention;
    return result;
  }
}
