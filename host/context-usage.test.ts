import { describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { newSession } from "../src/features/sessions/model/session";
import { applyHarnessEvent } from "../src/integrations/harness/core/apply";
import { contextFromUsageSnapshot } from "../src/integrations/harness/providers/claude/claudeProtocol";

describe("Host context breakdown", () => {
  it("persists the provider snapshot and includes it in mobile snapshot and delta sync", () => {
    const store = new HostStore(":memory:");
    try {
      const project = store.addProject("/repo", "Context test");
      const base = newSession("claude", "/repo");
      store.save({ projectId: project.id, revision: 1, status: "idle", createdAt: 1, updatedAt: 1, session: base }, { type: "seed" });
      const context = contextFromUsageSnapshot({ totalTokens: 1000, rawMaxTokens: 10000,
        categories: [{ name: "Messages", tokens: 1000, kind: "used" }],
        messageBreakdown: { toolResultTokens: 700 } }, 1234)!;
      const event = { type: "context" as const, ...context };
      const session = applyHarnessEvent(base, event);
      store.save({ projectId: project.id, revision: 2, status: "idle", createdAt: 1, updatedAt: 2, session }, event);
      const persisted = store.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(base.id)!;
      expect(JSON.parse(String(persisted.snapshot)).session.context).toEqual(context);
      const snapshot = store.sync(base.id);
      const delta = store.sync(base.id, 1);
      expect(snapshot.kind).toBe("snapshot");
      expect(delta.kind).toBe("delta");
      if (snapshot.kind === "snapshot") expect(snapshot.value.session.context).toEqual(context);
      if (delta.kind === "delta") expect(delta.value.session.context).toEqual(context);
    } finally { store.close(); }
  });
});
