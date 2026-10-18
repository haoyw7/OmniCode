import type { BotMemoryDocument } from "./botMemory";

export type BotMemoryDraft = {
  base: BotMemoryDocument;
  text: string;
  latest?: BotMemoryDocument;
  busy?: boolean;
  conflict?: boolean;
  error?: string;
  command?: { signature: string; id: string };
};
export type BotMemoryEditorState = { path: string; drafts: Record<string, BotMemoryDraft> };

/** Owned by one Host workspace; all of a Bot's retained Thread panels share drafts. */
export class BotMemoryDrafts {
  private values = new Map<string, BotMemoryEditorState>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get(botId: string): BotMemoryEditorState {
    let value = this.values.get(botId);
    if (!value) { value = { path: "MEMORY.md", drafts: {} }; this.values.set(botId, value); }
    return value;
  }
  update(botId: string, update: (state: BotMemoryEditorState) => BotMemoryEditorState) {
    this.values.set(botId, update(this.get(botId)));
    this.listeners.forEach((listener) => listener());
  }
  draft(botId: string, path: string, update: (draft: BotMemoryDraft | undefined) => BotMemoryDraft) {
    this.update(botId, (state) => ({ ...state, drafts: { ...state.drafts, [path]: update(state.drafts[path]) } }));
  }
}
