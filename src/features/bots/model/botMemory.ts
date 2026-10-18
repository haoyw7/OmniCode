export type BotMemoryKind = "soul" | "resident" | "topic" | "archive" | "log" | "playbook";
export type BotMemoryFile = {
  path: string;
  kind: BotMemoryKind;
  revision: number;
  hash: string;
  bytes: number;
  updatedAt: number;
};
export type BotMemoryBudget = {
  maxLines: number;
  maxBytes: number;
  lines: number;
  bytes: number;
  loadedLines: number;
  loadedBytes: number;
  truncated: boolean;
};
export type BotMemoryDocument = BotMemoryFile & {
  text: string;
  budget?: BotMemoryBudget;
};
export type BotMemoryList = {
  revision: number;
  files: BotMemoryFile[];
  topicLimit: number;
  topicsTruncated: boolean;
};
export type BotMemoryChange = {
  id: string;
  path: string;
  at: number;
  source: "user" | "assistant" | "external" | "migration" | "undo";
  revision: number;
  beforeHash: string;
  afterHash: string;
};
export type BotMemoryExpected = {
  expectedRevision: number;
  expectedHash: string;
};
export type BotMemoryContext = {
  soul: string;
  text: string;
  revision: number;
  hash: string;
  budget: BotMemoryBudget;
  topics: string[];
  topicsTruncated: boolean;
};
