// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { newSession, type Session } from "./session";
import { forkSession } from "./forkSession";

it("forks saved context into an independent conversation without locks, queues or unsent drafts", () => {
  const source: Session = {
    ...newSession("codex", "/repo"),
    title: "Existing work",
    providerSessionId: "occupied-thread",
    providerAccountId: "account",
    executionCwd: "/repo/worktree",
    branch: "feature",
    busy: true,
    modelSettings: { effort: "high" },
    nativeSession: { provider: "codex", providerSessionId: "occupied-thread", path: "/history.jsonl",
      revision: "1", createdAt: 1, updatedAt: 1, blockIds: [], nativeIds: [], mode: "managed" },
    queuedMessages: [{ id: "queue", text: "Queued work", attachments: [] }],
    blocks: [
      { id: "u", role: "user", text: "Review the implementation" },
      { id: "a", role: "assistant", text: "The implementation needs a fix" },
      { id: "draft", role: "user", text: "Unsent secret draft", draft: true },
    ],
  };
  const before = structuredClone(source);
  const fork = forkSession(source);
  expect(fork.id).not.toBe(source.id);
  expect(fork).toMatchObject({ cwd: source.cwd, executionCwd: source.executionCwd,
    branch: source.branch, harness: source.harness, model: source.model,
    providerAccountId: "account", modelSettings: { effort: "high" }, blocks: [],
    handoffCard: { from: "codex", to: "codex", request: "Review the implementation" },
  });
  expect(fork.handoffCard?.brief).toContain("The implementation needs a fix");
  expect(fork.handoffCard?.brief).not.toContain("Unsent secret draft");
  expect(fork.nativeSession).toBeUndefined();
  expect(fork.providerSessionId).toBeUndefined();
  expect(fork.queuedMessages).toBeUndefined();
  expect(fork.busy).toBeFalsy();
  expect(source).toEqual(before);
});
