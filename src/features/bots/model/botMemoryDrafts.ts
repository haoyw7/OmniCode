import type { BotMemoryDocument } from "./botMemory";
import { createStore } from "zustand/vanilla";

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
const empty: BotMemoryEditorState = { path: "MEMORY.md", drafts: {} };

/** Owned by one Host workspace; all of a Bot's retained Thread panels share drafts. */
export class BotMemoryDrafts {
  readonly store = createStore<Record<string, BotMemoryEditorState>>(() => ({}));
  subscribe = this.store.subscribe;
  get(botId: string): BotMemoryEditorState {
    return this.store.getState()[botId] ?? empty;
  }
  update(botId: string, update: (state: BotMemoryEditorState) => BotMemoryEditorState) {
    this.store.setState({ [botId]: update(this.get(botId)) });
  }
  draft(botId: string, path: string, update: (draft: BotMemoryDraft | undefined) => BotMemoryDraft) {
    this.update(botId, (state) => ({ ...state, drafts: { ...state.drafts, [path]: update(state.drafts[path]) } }));
  }
}
