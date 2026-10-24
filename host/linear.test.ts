import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxCredentials } from "./inbox-credentials";
import { HostLinear } from "./linear";

const cleanup: string[] = [];
afterEach(() => { for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-linear-")); cleanup.push(directory);
  const desktop = join(directory, "desktop"); mkdirSync(desktop);
  const credentials = new InboxCredentials(directory, () => desktop);
  const request = vi.fn<typeof fetch>();
  const service = new HostLinear(credentials, request);
  return { directory, desktop, credentials, request, service };
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

it("imports an existing desktop API key once without returning it, and keeps disconnect durable", async () => {
  const { desktop, credentials, service, request } = setup();
  writeFileSync(join(desktop, "linear-token"), "old-secret");
  expect(await service.run("linear_status")).toEqual({ connected: true });
  request.mockResolvedValue(response({ teams: { nodes: [{ id: "t", key: "ENG", name: "Engineering" }] } }));
  expect(await service.run("linear_list_teams")).toEqual([{ id: "t", key: "ENG", name: "Engineering" }]);
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "old-secret" });
  expect(await service.run("linear_set_token", { token: "" })).toEqual({ connected: false });
  expect(await new HostLinear(credentials, request).run("linear_status")).toEqual({ connected: false });
  expect(readFileSync(join(desktop, "linear-token"), "utf8")).toBe("old-secret");
});

it("validates replacement credentials before persisting and never echoes remote error bodies", async () => {
  const { service, credentials, request } = setup(); credentials.set("linear", "old");
  request.mockResolvedValueOnce(response({ viewer: { id: "me" } }));
  await service.run("linear_set_token", { token: "Bearer new-secret" });
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "new-secret" });
  request.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "leaked rejected-secret" }] }), { status: 400 }));
  await expect(service.run("linear_set_token", { token: "rejected-secret" })).rejects.toThrow("Linear request failed (400)");
  expect(credentials.get("linear", "linear-token")).toBe("Bearer new-secret");
});

it("preserves filters and existing issue DTO shape", async () => {
  const { service, credentials, request } = setup(); credentials.set("linear", "key");
  request.mockResolvedValue(response({ issues: { nodes: [{ id: "i", identifier: "ENG-7", number: 7, title: "Issue", url: "https://linear.app/i", updatedAt: "2026-01-01",
    state: { name: "Started", type: "started" }, team: { id: "t", key: "ENG", name: "Engineering" }, project: { id: "p", name: "Project" },
    labels: { nodes: [{ name: "bug", color: "#ff0000" }] }, assignee: { displayName: "Ada", avatarUrl: "avatar" } }] } }));
  const issues = await service.run("linear_list_issues", { assignedToMe: true, state: "open", teamIds: [" t ", ""], limit: 500 });
  expect(issues).toEqual([{ provider: "linear", kind: "linear", id: "i", identifier: "ENG-7", number: 7, title: "Issue", url: "https://linear.app/i", updatedAt: "2026-01-01",
    state: "Started", stateType: "started", teamId: "t", teamName: "Engineering", repo: "ENG", projectId: "p", projectName: "Project", projectPath: "", draft: false,
    labels: [{ name: "bug", color: "ff0000" }], assignees: [{ login: "Ada", avatarUrl: "avatar" }] }]);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).variables).toEqual({ first: 100, filter: { assignee: { isMe: { eq: true } }, team: { id: { in: ["t"] } }, state: { type: { nin: ["completed", "canceled"] } } } });
});

it("returns description authors and flattens descendant replies onto the root comment", async () => {
  const { service, credentials, request } = setup(); credentials.set("linear", "key");
  request.mockResolvedValueOnce(response({ issue: { description: "body", creator: { displayName: "Creator" } } }));
  expect(await service.run("linear_issue_details", { id: "ENG-1" })).toEqual({ body: "body", author: "Creator", authorAvatarUrl: "" });
  request.mockResolvedValueOnce(response({ issue: { comments: { pageInfo: { hasNextPage: true }, nodes: [
    { id: "b", body: "reply", createdAt: "2", parent: { id: "a" } }, { id: "a", body: "root", createdAt: "1" },
    { id: "c", body: "nested", createdAt: "3", parent: { id: "b" } }, { id: "orphan", parent: { id: "gone" }, createdAt: "4" },
  ] } } }));
  expect(await service.run("linear_issue_thread", { id: "ENG-1" })).toMatchObject({ comments: [{ id: "a", replies: [{ id: "b" }, { id: "c" }] }, { id: "orphan", replies: [] }], truncated: true });
});

it("validates comment inputs and forwards parent replies once", async () => {
  const { service, credentials, request } = setup(); credentials.set("linear", "key");
  await expect(service.run("linear_issue_comment", { id: "../bad", body: "text" })).rejects.toThrow("Missing Linear issue");
  await expect(service.run("linear_issue_comment", { id: "ENG-1", body: " " })).rejects.toThrow("Comment cannot be empty");
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(response({ commentCreate: { success: true, comment: { url: "https://linear.app/comment" } } }));
  expect(await service.run("linear_issue_comment", { id: "ENG-1", body: " reply ", parentId: "parent" })).toBe("https://linear.app/comment");
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).variables.input).toEqual({ issueId: "ENG-1", body: "reply", parentId: "parent" });
});
