import { describe, expect, it, vi } from "vitest";
import type { HostSession } from "../features/connections/model/protocol";
import { createSessionSnapshotStore, sameSessionShell, selectSessionShell } from "./sessionSnapshotStore";

function snapshot(revision = 1): HostSession {
  return {
    projectId: "project", revision, updatedAt: revision, status: "running", runId: "run",
    session: { id: "one", cwd: "/project", title: "Conversation", harness: "codex",
      model: "codex:model", modelSettings: {}, runtimeMode: "supervised",
      blocks: [{ id: "reply", role: "assistant", text: "Streaming", streaming: true }] },
  };
}

describe("mobile session snapshots", () => {
  it("rejects old revisions but accepts same-revision image hydration", () => {
    const store = createSessionSnapshotStore(snapshot(2));
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(snapshot(1));
    expect(store.get()?.revision).toBe(2);
    expect(listener).not.toHaveBeenCalled();
    const hydrated = snapshot(2);
    hydrated.session.blocks[0].attachments = [{ id: "photo", name: "photo.png", mimeType: "image/png",
      kind: "image", size: 3, previewUrl: "data:image/png;base64,YWJj" }];
    store.set(hydrated);
    expect(store.get()?.session.blocks[0].attachments?.[0].previewUrl).toContain("YWJj");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes only committed current snapshots to read acknowledgements", () => {
    const first = snapshot();
    const store = createSessionSnapshotStore(first);
    const listener = vi.fn();
    store.subscribeRendered(listener);
    expect(store.getRendered()).toBeUndefined();
    store.markRendered(first);
    const next = snapshot(2);
    store.set(next);
    expect(store.getRendered()).toBe(first);
    store.markRendered(first);
    expect(listener).toHaveBeenCalledTimes(1);
    store.markRendered(next);
    expect(store.getRendered()).toBe(next);
    store.set(undefined);
    store.markRendered(next);
    expect(store.getRendered()).toBeUndefined();
  });

  it("isolates text and context changes but retains queue acknowledgements and input transitions", () => {
    const first = snapshot();
    const next = snapshot(2);
    next.session.blocks[0].text = "Streaming more text";
    next.session.context = { used: 200, window: 1000 };
    expect(sameSessionShell(selectSessionShell(first), selectSessionShell(next))).toBe(true);
    const outgoing = { id: "sent", text: "Follow up", placement: "queue" as const };
    const queued = selectSessionShell(next, outgoing);
    expect(queued?.session.queuedMessages?.map(row => row.id)).toEqual(["sent"]);
    next.session.blocks.push({ id: "sent", role: "user", text: "Follow up" });
    const acknowledged = selectSessionShell(next, outgoing);
    expect(acknowledged?.session.queuedMessages).toBeUndefined();
    expect(sameSessionShell(queued, acknowledged)).toBe(false);
    next.session.pendingQuestion = { requestId: 4, questions: [] };
    expect(sameSessionShell(acknowledged, selectSessionShell(next))).toBe(false);
  });

  it("ignores native sync diagnostics but updates the shell when sending becomes blocked", () => {
    const first = snapshot();
    first.nativeStatus = { state: "ready", revision: "one", checkedAt: 1 };
    const next = snapshot(2);
    next.nativeStatus = { state: "ready", revision: "two", checkedAt: 2, hostTurn: true };
    expect(sameSessionShell(selectSessionShell(first), selectSessionShell(next))).toBe(true);
    next.nativeStatus = { state: "error", reason: "diverged", checkedAt: 3 };
    expect(sameSessionShell(selectSessionShell(first), selectSessionShell(next))).toBe(false);
  });
});
