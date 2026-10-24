import type { BtwCommand } from "../src/contracts/submission";
import type { BtwThread, Session } from "../src/contracts/session";
import { btwTurnHarness } from "../src/domain/btw";

/** Validate against the authoritative transcript, never a client-supplied snapshot. */
export function prepareBtw(session: Session, command: BtwCommand, now = Date.now()): Session {
  const index = session.blocks.findIndex(block => block.id === command.userBlockId && block.role === "user");
  if (index < 0) throw new Error("The source turn is no longer available");
  const anchor = session.blocks[index];
  const threads = anchor.btwThreads ?? [];
  const existing = threads.find(thread => thread.id === command.threadId);
  if (command.action !== "send" && !existing) throw new Error("Side conversation not found");
  let next: BtwThread | undefined = existing;
  if (command.action === "send") {
    if (existing?.status === "running") throw new Error("Wait for the side conversation to finish");
    if (existing && existing.sourceEndBlockId !== command.sourceEndBlockId) throw new Error("Side conversation source cannot change");
    const end = session.blocks.findIndex(block => block.id === command.sourceEndBlockId);
    const nextUser = session.blocks.findIndex((block, position) => position > index && block.role === "user" && !block.internal);
    if (end < index || (nextUser >= 0 && end >= nextUser) || anchor.durationMs == null)
      throw new Error("The source turn is not completed");
    if (threads.length >= 100 && !existing) throw new Error("Too many side conversations");
    if (existing?.messages.some(message => message.id === command.messageId)) throw new Error("Side message ID was already used");
    if ((existing?.messages.length ?? 0) >= 200) throw new Error("Side conversation is full");
    const harness = existing?.harness ?? btwTurnHarness(session.blocks, session.blocks.slice(index, end + 1), session.harness);
    if (!harness) throw new Error("This turn does not support side conversations");
    next = { ...existing, id: command.threadId, sourceEndBlockId: command.sourceEndBlockId,
      createdAt: existing?.createdAt ?? now, updatedAt: now, status: "running", harness,
      model: command.model ?? existing?.model ?? anchor.turnModel?.id ?? session.model,
      modelSettings: command.modelSettings ?? existing?.modelSettings ?? session.modelSettings,
      messages: [...(existing?.messages ?? []), { id: command.messageId, role: "user", text: command.text, createdAt: now }],
      error: undefined, pendingBlocks: [],
    };
  } else if (command.action === "retry") {
    if (existing!.status === "running" || existing!.messages.at(-1)?.role !== "user") throw new Error("Side conversation cannot retry this reply");
    next = { ...existing!, status: "running", updatedAt: now, pendingBlocks: [], error: undefined };
  } else if (command.action === "stop") {
    const blocks = existing!.pendingBlocks?.map(block => ({ ...block, streaming: false }));
    const answer = blocks?.filter(block => block.role === "assistant").map(block => block.text).join("\n") ?? "";
    next = { ...existing!, status: "ready", updatedAt: now, pendingBlocks: undefined, error: undefined,
      messages: [...existing!.messages, ...(blocks?.length ? [{ id: command.commandId, role: "assistant" as const,
        text: answer, createdAt: now, blocks }] : [])],
    };
  } else if (command.action === "configure") {
    if (existing!.status === "running") throw new Error("Wait for the side conversation to finish");
    next = { ...existing!, model: command.model, modelSettings: command.modelSettings, providerThreadId: undefined, updatedAt: now };
  } else if (command.action === "delete") next = undefined;
  return { ...session, blocks: session.blocks.map((block, position) => position === index
    ? { ...block, btwThreads: [...threads.filter(thread => thread.id !== command.threadId), ...(next ? [next] : [])].sort((a, b) => a.createdAt - b.createdAt) }
    : block) };
}
