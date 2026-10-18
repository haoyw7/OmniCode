import { describe, expect, it } from "vitest";
import {
  agentWaitingForWorktree,
  appendWorktreeCreationLog,
  anchorWorktreeCreation,
  completeWorktreeCreation,
  foldWorktreeCreation,
  failWorktreeCreation,
  parsePersistedWorktreeCreation,
  persistWorktreeCreation,
  startWorktreeCreation,
  worktreeCreationFromRecord,
} from "./worktreeCreation";

describe("worktree creation log", () => {
  it("starts with the app step and keeps git output verbatim", () => {
    let creation = startWorktreeCreation("main", "run-1");
    creation = appendWorktreeCreationLog(
      creation,
      "run-1",
      "Preparing worktree (new branch 'mc/3f2a1b7c')",
    );
    expect(creation.status).toBe("creating");
    expect(creation.log).toEqual([
      { kind: "info", key: "Starting worktree creation" },
      { kind: "info", key: "Generating branch and worktree names…" },
      { kind: "output", text: "Preparing worktree (new branch 'mc/3f2a1b7c')" },
    ]);
  });

  it("redraws git progress in place instead of appending each update", () => {
    const creation = [
      "Preparing worktree (new branch 'mc/x')",
      "Updating files:  22% (1637/7412)",
      "Updating files:  97% (7178/7412)",
      "Updating files: 100% (7412/7412), done.",
      "HEAD is now at 4e534a7 feat",
    ].reduce(
      (next, line) => appendWorktreeCreationLog(next, "run-1", line),
      startWorktreeCreation("main", "run-1"),
    );
    expect(creation.log.slice(2)).toEqual([
      { kind: "output", text: "Preparing worktree (new branch 'mc/x')" },
      { kind: "output", text: "Updating files: 100% (7412/7412), done." },
      { kind: "output", text: "HEAD is now at 4e534a7 feat" },
    ]);
  });

  it("ignores lines and results that belong to another creation", () => {
    const creation = startWorktreeCreation("main", "run-1");
    expect(appendWorktreeCreationLog(creation, "run-0", "stale")).toBe(
      creation,
    );
    expect(
      completeWorktreeCreation(creation, "run-0", "/trees/mc-3f2a1b7c"),
    ).toBe(creation);
    expect(failWorktreeCreation(creation, "run-0", "stale")).toBe(creation);
  });

  it("completes with the working copy path and stops accepting results", () => {
    const creation = startWorktreeCreation("main", "run-1");
    const done = completeWorktreeCreation(
      creation,
      "run-1",
      "/trees/mc-3f2a1b7c",
    );
    expect(done.status).toBe("created");
    expect(done.path).toBe("/trees/mc-3f2a1b7c");
    expect(done.log[done.log.length - 1]).toEqual({
      kind: "text",
      key: "Worktree created at {value0}",
      values: { value0: "/trees/mc-3f2a1b7c" },
    });
    expect(completeWorktreeCreation(done, "run-1", "/trees/other")).toBe(done);
  });

  it("keeps a failure message in the log instead of completing", () => {
    const creation = startWorktreeCreation("main", "run-1");
    const failed = failWorktreeCreation(
      creation,
      "run-1",
      "fatal: a branch named 'mc/x' already exists",
    );
    expect(failed.status).toBe("failed");
    expect(failed.path).toBeUndefined();
    expect(failed.log[failed.log.length - 1]).toEqual({
      kind: "error",
      text: "fatal: a branch named 'mc/x' already exists",
    });
    expect(completeWorktreeCreation(failed, "run-1", "/trees/x")).toBe(failed);
  });

  it("anchors the card once, to its own creation", () => {
    const creation = startWorktreeCreation("main", "run-1");
    expect(anchorWorktreeCreation(creation, "run-0", "user-1")).toBe(creation);
    const anchored = anchorWorktreeCreation(creation, "run-1", "user-1");
    expect(anchored.afterBlockId).toBe("user-1");
    expect(anchorWorktreeCreation(anchored, "run-1", "user-2")).toBe(anchored);
  });

  it("folds only a finished creation that still matches", () => {
    const creating = startWorktreeCreation("main", "run-1");
    expect(foldWorktreeCreation(creating, "run-1")).toBe(creating);
    const done = completeWorktreeCreation(creating, "run-1", "/trees/x");
    expect(foldWorktreeCreation(done, "run-0")).toBe(done);
    expect(foldWorktreeCreation(done, "run-1").folded).toBe(true);
  });

  it("keeps the agent waiting while its worktree is made and until the host takes the message", () => {
    const sending = [{ id: "user-1", sending: true }];
    const settled = [{ id: "user-1" }];
    const creating = anchorWorktreeCreation(
      startWorktreeCreation("main", "run-1"),
      "run-1",
      "user-1",
    );
    const created = anchorWorktreeCreation(
      completeWorktreeCreation(
        startWorktreeCreation("main", "run-1"),
        "run-1",
        "/trees/x",
      ),
      "run-1",
      "user-1",
    );
    expect(agentWaitingForWorktree(undefined, sending)).toBe(false);
    expect(agentWaitingForWorktree(creating, sending)).toBe(true);
    expect(agentWaitingForWorktree(created, sending)).toBe(true);
    expect(agentWaitingForWorktree(created, settled)).toBe(false);
    expect(
      agentWaitingForWorktree(
        failWorktreeCreation(creating, "run-1", "boom"),
        settled,
      ),
    ).toBe(false);
  });

  it("keeps a finished creation's record on its message, validated on the way back in", () => {
    const creation = completeWorktreeCreation(
      appendWorktreeCreationLog(
        startWorktreeCreation("main", "run-1"),
        "run-1",
        "Preparing worktree (new branch 'mc/3f2a1b7c')",
      ),
      "run-1",
      "/trees/mc-3f2a1b7c",
    );
    const record = persistWorktreeCreation(creation);
    expect(record).toEqual({
      base: "main",
      path: "/trees/mc-3f2a1b7c",
      log: creation.log,
    });
    expect(persistWorktreeCreation(startWorktreeCreation("main", "run-1"))).toBeUndefined();
    expect(
      parsePersistedWorktreeCreation(JSON.parse(JSON.stringify(record))),
    ).toEqual(record);
    expect(
      parsePersistedWorktreeCreation({ base: "main", path: "/x", log: [{ kind: "nope" }] }),
    ).toBeUndefined();
    expect(parsePersistedWorktreeCreation("garbage")).toBeUndefined();
    expect(
      worktreeCreationFromRecord("user-1", record!),
    ).toMatchObject({
      id: "user-1",
      status: "created",
      folded: true,
      afterBlockId: "user-1",
      path: "/trees/mc-3f2a1b7c",
    });
  });
});
