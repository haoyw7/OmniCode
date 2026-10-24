import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxCredentials } from "./inbox-credentials";
import { HostAzureDevOps, azureRepoFromRemote, normalizeAzureDevOpsUrl } from "./azure-devops";
import { localMachineIO, withMachineIO } from "./machine-io";
import type { AzureDevOpsMrDiff, AzureDevOpsWorkItemThread } from "../src/contracts/azureDevOps";

const cleanup: string[] = [];
afterEach(() => { for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const config = { url: "https://dev.azure.com/acme", token: "private-pat" };
const response = (value: unknown, headers?: Record<string, string>) => new Response(JSON.stringify(value), { status: 200, headers });
function setup(connected = true) {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-azure-test-")); cleanup.push(directory);
  const desktop = join(directory, "desktop"); mkdirSync(desktop);
  const credentials = new InboxCredentials(directory, () => desktop);
  if (connected) credentials.set("azuredevops", config);
  const request = vi.fn<typeof fetch>(); const service = new HostAzureDevOps(credentials, request);
  const exec = vi.fn().mockResolvedValue({ stdout: "remote.backup.url https://dev.azure.com/acme/Other/_git/backup\nremote.origin.url git@ssh.dev.azure.com:v3/acme/Project/Repo", stderr: "" });
  const onMachine = <T>(work: () => Promise<T>) => withMachineIO({ ...localMachineIO, key: "wsl:Ubuntu", pathStyle: "posix", exec }, work);
  return { directory, desktop, credentials, request, service, exec, onMachine };
}

it("keeps hosted, legacy and on-prem organization/remotes while rejecting unsafe destinations", () => {
  expect(normalizeAzureDevOpsUrl("Acme")).toBe("https://dev.azure.com/Acme");
  expect(normalizeAzureDevOpsUrl("https://Acme.visualstudio.com/Project/_git/Repo")).toBe(config.url);
  expect(normalizeAzureDevOpsUrl("https://tfs.contoso.com:8443/tfs/collection/Project/_git/Repo")).toBe("https://tfs.contoso.com:8443/tfs/collection");
  for (const value of ["http://dev.azure.com/acme", "https://token@dev.azure.com/acme", "https://dev.azure.com", "https://dev.azure.com/acme?secret=x", "https://dev.azure.com/ac me"]) expect(() => normalizeAzureDevOpsUrl(value)).toThrow();
  for (const value of ["git@ssh.dev.azure.com:v3/acme/Project%20One/Repo.git", "https://user@dev.azure.com/acme/Project%20One/_git/Repo.git", "https://acme.visualstudio.com/Project%20One/_git/Repo.git"]) expect(azureRepoFromRemote(value, config.url)).toBe("Project One/Repo");
  expect(azureRepoFromRemote("https://tfs.local/tfs/collection/Project/_git/Repo", "https://tfs.local/tfs/collection")).toBe("Project/Repo");
  expect(azureRepoFromRemote("https://dev.azure.com/other/Project/_git/Repo", config.url)).toBeUndefined();
});

it("imports private legacy config once, validates replacements and never returns PATs or echoed remote errors", async () => {
  const { desktop, credentials, service, request } = setup(false);
  writeFileSync(join(desktop, "azure-devops-config.json"), JSON.stringify(config));
  expect(await service.run("azure_devops_status")).toEqual({ connected: true, url: config.url, organization: config.url });
  request.mockResolvedValueOnce(response({ authenticatedUser: { id: "me" } }));
  expect(await service.run("azure_devops_set_config", { url: "acme", token: "replacement" })).not.toHaveProperty("token");
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from(":replacement").toString("base64")}` });
  expect(request.mock.calls[0][1]?.redirect).toBe("error");
  expect(String(request.mock.calls[0][0])).toContain("7.1-preview.1");
  request.mockResolvedValueOnce(new Response("echo private-token", { status: 400 }));
  await expect(service.run("azure_devops_set_config", { url: "acme", token: "private-token" })).rejects.toThrow("Azure DevOps request failed (400)");
  expect(credentials.get("azuredevops", "azure-devops-config.json")).toMatchObject({ token: "replacement" });
  await service.run("azure_devops_set_config", { url: "acme", token: "" });
  expect(await new HostAzureDevOps(credentials).run("azure_devops_status")).toEqual({ connected: false, url: "", organization: "" });
});

it.each([203, 401, 403])("rejects an authentication failure (%s) without persisting the failed token", async status => {
  const { credentials, request, service } = setup();
  request.mockResolvedValueOnce(new Response("private-pat", { status }));
  await expect(service.run("azure_devops_set_config", { url: "acme", token: "rejected" })).rejects.toThrow("invalid or lacks permission");
  expect(credentials.get("azuredevops", "azure-devops-config.json")).toEqual(config);
});

it("resolves origin on the selected execution machine and preserves Boards WIQL, fields and task projection", async () => {
  const { service, request, exec, onMachine } = setup();
  expect(await onMachine(() => service.run("azure_devops_repo", { cwd: "/work/repo" }))).toBe("Project/Repo");
  expect(exec).toHaveBeenCalledWith("git", ["config", "--get-regexp", "^remote\\..*\\.url$"], expect.objectContaining({ cwd: "/work/repo" }));
  request.mockResolvedValueOnce(response({ workItems: [{ id: 8 }, { id: -1 }] }))
    .mockResolvedValueOnce(response({ value: [{ id: 8, fields: { "System.Title": "Bug", "System.State": "Active", "System.TeamProject": "Project", "System.ChangedDate": "2026-10-21", "System.Tags": "bug; urgent", "System.AssignedTo": { displayName: "Ada", imageUrl: "avatar" } }, _links: { html: { href: "https://item" } } }] }));
  const items = await onMachine(() => service.run("azure_devops_list_work_items", { cwd: "/work/repo", kind: "issue", assignedToMe: true, state: "open", limit: 5 }));
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query).toBe("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Project' AND [System.AssignedTo] = @me AND [System.State] NOT IN ('Closed', 'Done', 'Removed') ORDER BY [System.ChangedDate] DESC");
  expect(String(request.mock.calls[0][0])).toContain("$top=5");
  expect(items).toEqual([expect.objectContaining({ kind: "issue", number: 8, state: "open", repo: "Project", assignees: [{ login: "Ada", avatarUrl: "avatar" }], labels: [{ name: "bug", color: "" }, { name: "urgent", color: "" }] })]);
});

it("combines all PR states, reviewer filtering and URL fallback without dropping closed results", async () => {
  const { service, request, onMachine } = setup();
  request.mockResolvedValueOnce(response({ authorizedUser: { id: "reviewer" } }));
  for (const [index, status] of ["active", "completed", "abandoned"].entries()) request.mockResolvedValueOnce(response({ value: [{ pullRequestId: index + 1, title: status, status, creationDate: `2026-10-0${index + 1}`, ...(index ? { closedDate: `2026-10-1${index}` } : {}), reviewers: [{ displayName: "Ada" }], createdBy: { displayName: "Ada" }, isDraft: index === 0 }] }));
  const items = await onMachine(() => service.run("azure_devops_list_work_items", { cwd: "/repo", kind: "pr", assignedToMe: true, state: "all", limit: 2 }));
  expect(items).toEqual([expect.objectContaining({ number: 3, state: "closed", url: `${config.url}/Project/_git/Repo/pullrequest/3` }), expect.objectContaining({ number: 2, state: "merged" })]);
  expect(request.mock.calls.slice(1).every(call => String(call[0]).includes("searchCriteria.reviewerId=reviewer&$top=4"))).toBe(true);
});

it("lists cross-project review requests and assigned Boards tasks with attention reasons", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ authenticatedUser: { id: "me" } })).mockResolvedValueOnce(response({ value: [{ pullRequestId: 1, status: "active", repository: { name: "Repo", project: { name: "Project" } } }, { pullRequestId: 2 }] }));
  expect(await service.run("azure_devops_list_todos", { kind: "pr" })).toEqual([expect.objectContaining({ repo: "Project/Repo", attentionReason: "review_requested" })]);
  request.mockResolvedValueOnce(response({ workItems: [{ id: 2 }] })).mockResolvedValueOnce(response({ value: [{ id: 2, fields: { "System.TeamProject": "Other" } }] }));
  expect(await service.run("azure_devops_list_todos", { kind: "issue" })).toEqual([expect.objectContaining({ attentionReason: "assigned" })]);
});

it("preserves PR and Boards details, thread order, deletion/resolution flags and truncated comments", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ description: "Body", targetRefName: "refs/heads/main", sourceRefName: "refs/heads/topic", createdBy: { displayName: "Ada", _links: { avatar: { href: "avatar" } } } }));
  expect(await service.run("azure_devops_work_item_details", { repo: "Project/Repo", kind: "pr", number: 7 })).toEqual({ body: "Body", author: "Ada", authorAvatarUrl: "avatar", baseRefName: "main", headRefName: "topic", reviewDecision: "" });
  request.mockResolvedValueOnce(response({ fields: { "System.Description": "<p>Boards</p>", "System.CreatedBy": { displayName: "Grace", imageUrl: "picture" } } }));
  expect(await service.run("azure_devops_work_item_details", { repo: "", kind: "issue", number: 8 })).toMatchObject({ body: "<p>Boards</p>", author: "Grace" });
  request.mockResolvedValueOnce(response({ value: [{ id: 10, status: "fixed", comments: [{ id: 2, content: "Later", publishedDate: "2026-10-22", author: { displayName: "Ada" } }, { id: 1, content: "Earlier", publishedDate: "2026-10-21" }, { id: 3, content: "Deleted", isDeleted: true }] }] }, { "x-ms-continuationtoken": "next" }));
  const thread = await service.run("azure_devops_work_item_thread", { repo: "Project/Repo", kind: "pr", number: 7 }) as AzureDevOpsWorkItemThread;
  expect(thread.truncated).toBe(true); expect(thread.comments.map(value => [value.id, value.resolved, value.threadId])).toEqual([["10-1", true, "10"], ["10-2", true, "10"]]);
  request.mockResolvedValueOnce(response({ totalCount: 2, comments: [{ commentId: 5, text: "Board comment", createdDate: "now", createdBy: { displayName: "Grace" }, url: "comment-url" }] }));
  expect(await service.run("azure_devops_work_item_thread", { repo: "Project/Repo", kind: "issue", number: 8 })).toMatchObject({ truncated: true, comments: [expect.objectContaining({ id: "5", url: "comment-url" })] });
  expect(String(request.mock.lastCall?.[0])).toContain("/Project/_apis/wit/workitems/8/comments?api-version=7.1-preview.4");
});

it("posts PR threads and Boards comments with their original payload and rejects invalid IDs before HTTP", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ url: "https://comment" }));
  expect(await service.run("azure_devops_work_item_comment", { repo: "Project/Repo", kind: "pr", number: 4, body: " Comment " })).toBe(`${config.url}/Project/_git/Repo/pullrequest/4`);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ comments: [{ parentCommentId: 0, content: "Comment", commentType: 1 }], status: 1 });
  expect(await service.run("azure_devops_work_item_comment", { repo: "Project", kind: "issue", number: 9, body: "Comment" })).toBe("https://comment");
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ text: "Comment" });
  for (const args of [{ kind: "invalid", repo: "Project/Repo", number: 1 }, { kind: "pr", repo: "../Repo", number: 1 }, { kind: "pr", repo: "Project/Repo", number: -1 }]) await expect(service.run("azure_devops_work_item_thread", args)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});

it("renders text, addition, deletion and binary diff rows while keeping oversized files listed", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ value: [{ id: 1 }, { id: 3, sourceRefCommit: { commitId: "source" }, commonRefCommit: { commitId: "base" } }] }))
    .mockResolvedValueOnce(response({ changeEntries: [
      { item: { path: "/add.txt" }, changeType: "add" }, { item: { path: "/binary.bin" }, changeType: "edit" },
      { item: { path: "/delete.txt" }, changeType: "delete" }, { item: { path: "/edit.txt" }, changeType: "edit" },
      { item: { path: "/large.txt" }, changeType: "add" }, { item: { path: "/folder", isFolder: true } },
    ] }));
  request.mockImplementation(async input => {
    const url = String(input); const base = url.includes("versionDescriptor.version=base");
    if (url.includes("/add.txt")) return new Response("new\n");
    if (url.includes("/binary.bin")) return new Response(new Uint8Array([0, 1, 2]));
    if (url.includes("/delete.txt")) return response({ content: "old\n" });
    if (url.includes("/edit.txt")) return new Response(base ? "before\n" : "after\n");
    if (url.includes("/large.txt")) return new Response("x".repeat(512 * 1024 + 1));
    throw new Error("Unexpected request");
  });
  const diff = await service.run("azure_devops_mr_diff", { repo: "Project/Repo", number: 1 }) as AzureDevOpsMrDiff;
  expect(diff.files.map(file => file.path)).toEqual(["add.txt", "binary.bin", "delete.txt", "edit.txt", "large.txt"]);
  expect(diff).toMatchObject({ additions: 2, deletions: 2, truncated: true });
  expect(diff.patch).toContain("new file mode 100644"); expect(diff.patch).toContain("deleted file mode 100644");
  expect(diff.patch).toContain("Binary files a/binary.bin and b/binary.bin differ");
  expect(diff.patch).toContain("-before\n+after\n"); expect(diff.patch).not.toContain("large.txt");
});

it("caps rendered hunks at forty without dropping other changed file rows", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ value: [{ id: 1, sourceRefCommit: { commitId: "s" }, targetRefCommit: { commitId: "b" } }] }))
    .mockResolvedValueOnce(response({ changeEntries: Array.from({ length: 41 }, (_, index) => ({ item: { path: `/file-${index}` }, changeType: "add" })) }))
    .mockImplementation(async () => new Response(new Uint8Array([0])));
  const diff = await service.run("azure_devops_mr_diff", { repo: "Project/Repo", number: 1 }) as AzureDevOpsMrDiff;
  expect(diff.files).toHaveLength(41); expect(diff.truncated).toBe(true); expect(diff.patch.match(/diff --git /g)).toHaveLength(40);
});
