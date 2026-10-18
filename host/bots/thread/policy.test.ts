import { expect, it } from "vitest";
import { fullBotPolicy } from "../../../src/features/bots/model/botView";
import {
  checkPolicy,
  workspacePermission,
  validatePolicy,
} from "./policy";
import { WORKSPACE_COMMANDS } from "../../workspace-commands";
it("maps every workspace action and fails closed on future commands", () => {
  for (const command of WORKSPACE_COMMANDS)
    expect(workspacePermission(command)).toBeTruthy();
  expect(() => workspacePermission("future_shell")).toThrow();
  expect(workspacePermission("git_push")).toBe("git.publish");
  expect(workspacePermission("delete_path")).toBe("files.write");
});
it("blocks revoked permissions and project scope", () => {
  const policy = fullBotPolicy();
  checkPolicy(policy, "sessions.send", "project");
  policy.permissions["sessions.send"] = false;
  expect(() => checkPolicy(policy, "sessions.send", "project")).toThrow(
    /permission/i,
  );
  policy.allowedProjects = ["allowed"];
  expect(() => checkPolicy(policy, "sessions.read", "other")).toThrow(/scope/i);
});
it("rejects unknown policy fields and disabled missing permissions", () => {
  expect(() =>
    validatePolicy({ ...fullBotPolicy(), secret: true }),
  ).toThrow();
  const policy = validatePolicy({ permissions: {}, allowedProjects: [] });
  expect(policy.permissions["sessions.send"]).toBe(false);
});

it("validates ongoing project follows and individual exclusions without enabling permissions", () => {
  const policy = validatePolicy({ permissions: {}, allowedProjects: [], followedProjects: ["p1", "p2"], excludedSessionIds: ["s"] });
  expect(policy.followedProjects).toEqual(["p1", "p2"]);
  expect(policy.excludedSessionIds).toEqual(["s"]);
  expect(() => checkPolicy(policy, "sessions.send", "p1")).toThrow(/Permission/);
  expect(validatePolicy({ ...fullBotPolicy(), followedProjects: "all" }).followedProjects).toBe("all");
  for (const patch of [{ followedProjects: true }, { followedProjects: [""] }, { excludedSessionIds: "all" }, { excludedSessionIds: [false] }])
    expect(() => validatePolicy({ ...fullBotPolicy(), ...patch })).toThrow();
});
