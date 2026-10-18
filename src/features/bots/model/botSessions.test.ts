import { expect, it } from "vitest";
import { fullBotPolicy, type BotWatch } from "./botView";
import {
  hasBotPermission,
  followSession,
  followSessionProjects,
  isWatchedSession,
  removeWatchedSession,
} from "./botSessions";

const watch: BotWatch = {
  id: "activity",
  enabled: true,
  projectIds: [],
  sessionIds: [],
  eventKinds: ["completed"],
  prompt: "Follow up",
};

it("treats an empty or legacy project-wide watch as no explicit session authorization", () => {
  expect(isWatchedSession(fullBotPolicy(), [watch], "p", "s")).toBe(
    false,
  );
  expect(
    isWatchedSession(
      fullBotPolicy(),
      [{ ...watch, sessionIds: ["s"] }],
      "p",
      "s",
    ),
  ).toBe(true);
});

it("removes all matching watch rules and the individual grant without widening the remaining scope", () => {
  const policy = {
    ...fullBotPolicy(),
    followedSessions: [{ projectId: "p", sessionId: "s" }],
  };
  const watches = [watch, { ...watch, id: "explicit", sessionIds: ["s"] }];
  const removed = removeWatchedSession(policy, watches, "s");
  expect(isWatchedSession(removed.policy, removed.watches, "p", "s")).toBe(
    false,
  );
  expect(isWatchedSession(removed.policy, removed.watches, "p", "other")).toBe(
    false,
  );
  expect(policy.followedSessions).toHaveLength(1);
  expect(removed.policy.permissions).toEqual(policy.permissions);
});

it("keeps followed sessions within configured permissions and the owning project", () => {
  const policy = {
    ...fullBotPolicy(),
    allowedProjects: ["p"],
    followedSessions: [{ projectId: "p", sessionId: "s" }],
  };
  policy.permissions["sessions.approve"] = false;
  expect(isWatchedSession(policy, [], "other", "s")).toBe(false);
  expect(hasBotPermission(policy, "sessions.approve", "p")).toBe(false);
  expect(hasBotPermission(policy, "sessions.send", "p")).toBe(true);
  expect(hasBotPermission(policy, "sessions.read", "other")).toBe(false);
});

it("continues following new conversations only inside the selected projects", () => {
  const policy = followSessionProjects(fullBotPolicy(), ["p1", "p2"], []);
  expect(isWatchedSession(policy, [], "p1", "existing")).toBe(true);
  expect(isWatchedSession(policy, [], "p2", "future")).toBe(true);
  expect(isWatchedSession(policy, [], "p3", "future")).toBe(false);
  const all = followSessionProjects(policy, "all", []);
  expect(isWatchedSession(all, [], "future-project", "future-session")).toBe(
    true,
  );
});

it("keeps individual removals excluded until explicitly followed again", () => {
  const policy = followSessionProjects(fullBotPolicy(), "all", []);
  const removed = removeWatchedSession(policy, [], "excluded").policy;
  expect(isWatchedSession(removed, [], "p1", "excluded")).toBe(false);
  expect(isWatchedSession(removed, [], "p1", "future")).toBe(true);
  expect(
    isWatchedSession(
      followSession(removed, "p1", "excluded"),
      [],
      "p1",
      "excluded",
    ),
  ).toBe(true);
  const selected = followSessionProjects(
    removed,
    ["p2"],
    [{ id: "excluded", projectId: "p1" }],
  );
  expect(selected.excludedSessionIds).toEqual(["excluded"]);
  const restored = followSessionProjects(
    removed,
    ["p1"],
    [{ id: "excluded", projectId: "p1" }],
  );
  expect(isWatchedSession(restored, [], "p1", "excluded")).toBe(true);
});
