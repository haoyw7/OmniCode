import type { InboxAskContext } from "../src/contracts/inbox";
import { inboxAskPrompt } from "../src/domain/inboxPrompt";
import instructions from "../src/instructions/inbox.md?raw";

const providers = new Set(["github", "linear", "jira", "gitlab", "azuredevops"]);

export function parseInboxAsk(value: unknown): InboxAskContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inbox source");
  const source = value as Record<string, unknown>;
  const field = (name: string, max: number, allowEmpty = false) => {
    const text = source[name];
    if (typeof text !== "string" || (!allowEmpty && !text.trim()) || text.length > max || text.includes("\0"))
      throw new Error(`Invalid inbox ${name}`);
    return text;
  };
  if (!providers.has(String(source.provider))) throw new Error("Invalid inbox provider");
  return {
    key: field("key", 4096), title: field("title", 4096, true), url: field("url", 8192, true),
    provider: source.provider as InboxAskContext["provider"],
    ...(source.description !== undefined ? { description: field("description", 256_000, true) } : {}),
  };
}

export function inboxPrompt(context: InboxAskContext | undefined, text: string): string {
  return inboxAskPrompt(context, text, instructions);
}

