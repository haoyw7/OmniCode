import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostGithub, githubThread, githubCheckState, type GithubRunner } from "./github";
import { localMachineIO, withMachineIO } from "./machine-io";

const cleanup: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });
const reply = (value: unknown) => JSON.stringify(value);
const issue = { number: 7, title: "Task", url: "https://github.com/owner/repo/issues/7", state: "OPEN", stateReason: "REOPENED", createdAt: "1", updatedAt: "2", labels: [{ name: "bug", color: "f00" }], assignees: [{ login: "ada" }] };
const params = { cwd: "/repo", repo: "owner/repo", kind: "issue", number: 7 };
function setup() { const execute = vi.fn<GithubRunner>(); const git = vi.fn<GithubRunner>(); return { execute, git, service: new HostGithub(execute, git) }; }

it("distinguishes missing gh, unauthenticated accounts and old gh without --active", async () => {
  const { service, execute } = setup();
  execute.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOENT" }));
  expect(await service.run("git_github_status")).toEqual({ connected: false, installed: false, authenticated: false });
  execute.mockRejectedValueOnce({ stderr: "not authenticated" });
  expect(await service.run("git_github_status")).toEqual({ connected: false, installed: true, authenticated: false });
  execute.mockRejectedValueOnce({ stderr: "unknown flag: --active" }).mockResolvedValueOnce("");
  expect(await service.run("git_github_status")).toEqual({ connected: true, installed: true, authenticated: true });
  expect(execute.mock.calls.at(-1)?.[0]).toEqual(["auth", "status", "--hostname", "github.com"]);
});
it("discovers a repository and its fork parent without duplicating equal-case identities", async () => {
  const { service, execute } = setup();
  execute.mockResolvedValueOnce(reply({ nameWithOwner: "owner/repo" }));
  expect(await service.run("git_github_repo", { cwd: "/repo" })).toBe("owner/repo");
  execute.mockResolvedValueOnce(reply({ nameWithOwner: "owner/repo", parent: { owner: { login: "upstream" }, name: "repo" } }));
  expect(await service.run("git_github_repositories", { cwd: "/repo" })).toEqual(["owner/repo", "upstream/repo"]);
});
it("resolves WSL repository Git remotes while retaining the Host gh account", async () => {
  const { service, execute, git } = setup();
  git.mockResolvedValue("origin\tgit@github.com:owner/repo.git (fetch)\n"); execute.mockResolvedValue(reply({ nameWithOwner: "owner/repo" }));
  await withMachineIO({ ...localMachineIO, key: "wsl:Ubuntu", pathStyle: "posix" }, () => service.run("git_github_repo", { cwd: "/home/dev/repo" }));
  expect(execute.mock.calls[0][0]).toEqual(["repo", "view", "owner/repo", "--json", "nameWithOwner"]);
});
it("preserves list filters, explicit repo targeting, labels and assignee avatars", async () => {
  const { service, execute } = setup(); execute.mockResolvedValue(reply([issue]));
  expect(await service.run("git_github_work_items", { ...params, assignedToMe: true, state: "all", search: "label:bug", limit: 500 })).toEqual([{
    ...issue, kind: "issue", repo: "owner/repo", state: "open", stateReason: "reopened", draft: false,
    assignees: [{ login: "ada", avatarUrl: "https://avatars.githubusercontent.com/ada?s=64" }],
  }]);
  expect(execute.mock.calls[0][0]).toEqual(["issue", "list", "--state", "all", "--limit", "100", "--repo", "owner/repo", "--json", "number,title,url,state,stateReason,createdAt,updatedAt,labels,assignees", "--assignee", "@me", "--search", "label:bug"]);
});
it("reads one item and its body/review metadata through explicit repository arguments", async () => {
  const { service, execute } = setup(); execute.mockResolvedValueOnce(reply(issue)).mockResolvedValueOnce(reply({ body: "Description", author: { login: "ada" }, baseRefName: "main", headRefName: "topic", reviewDecision: "APPROVED" }));
  expect(await service.run("git_github_work_item", params)).toMatchObject({ number: 7, state: "open" });
  expect(await service.run("git_github_work_item_details", { ...params, kind: "pr" })).toMatchObject({ body: "Description", author: "ada", baseRefName: "main", headRefName: "topic", reviewDecision: "APPROVED" });
});
it("keeps review groups, hidden comment filtering, commits and truncation in thread projections", async () => {
  const data = { data: { repository: { pullRequest: { baseRefName: "main", headRefName: "topic", reviewDecision: "CHANGES_REQUESTED",
    comments: { totalCount: 3, nodes: [{ id: "comment", createdAt: "1", body: "text", author: { login: "ada" } }, { id: "hidden", isMinimized: true }] },
    commits: { totalCount: 1, nodes: [{ commit: { oid: "sha", messageHeadline: "Fix", committedDate: "0", author: { name: "Name", user: { login: "ada" } } } }] },
    reviews: { totalCount: 2, nodes: [{ id: "review", state: "APPROVED", submittedAt: "2", body: "" }, { id: "pending", state: "PENDING", body: "private" }] },
    reviewThreads: { totalCount: 1, nodes: [{ id: "thread", isResolved: true, path: "a.ts", comments: { totalCount: 3, nodes: [{ id: "root", createdAt: "3", originalLine: 9 }, { id: "reply", createdAt: "4", body: "reply" }] } }] },
  } } } };
  expect(githubThread(data, "pr")).toMatchObject({ truncated: true, reviewDecision: "CHANGES_REQUESTED", commits: [{ oid: "sha", author: "ada" }], comments: [
    { id: "comment", kind: "comment" }, { id: "review", kind: "review", state: "APPROVED" },
    { id: "root", kind: "review_comment", threadId: "thread", path: "a.ts", line: 9, resolved: true, replies: [{ id: "reply", threadId: "thread" }] },
  ] });
  const { service, execute } = setup(); execute.mockResolvedValue(reply(data));
  await service.run("git_github_work_item_thread", { ...params, kind: "pr" });
  expect(JSON.parse(execute.mock.calls[0][2]!).variables).toEqual({ owner: "owner", name: "repo", number: 7 });
});
it("posts comments and review replies through stdin, never command-line text interpolation", async () => {
  const { service, execute } = setup(); const body = "literal $() and `backticks`\nsecond line";
  execute.mockResolvedValueOnce("https://github.com/owner/repo/issues/7#comment");
  expect(await service.run("git_github_work_item_comment", { ...params, body })).toContain("#comment");
  expect(execute.mock.calls[0]).toEqual([["issue", "comment", "7", "--repo", "owner/repo", "--body-file", "-"], "/repo", body, undefined]);
  execute.mockResolvedValueOnce(reply({ data: { addPullRequestReviewThreadReply: { comment: { url: "https://github.com/reply" } } } }));
  expect(await service.run("git_github_work_item_comment", { ...params, kind: "pr", body, inReplyTo: "PRRT_thread" })).toBe("https://github.com/reply");
  expect(JSON.parse(execute.mock.calls[1][2]!).variables).toEqual({ threadId: "PRRT_thread", body });
});
it.each(["merge", "squash", "rebase", "draft", "ready", "close", "reopen"])("executes PR action %s once and reads the resulting state", async action => {
  const { service, execute } = setup(); execute.mockResolvedValueOnce("").mockResolvedValueOnce(reply({ ...issue, isDraft: action === "draft" }));
  expect(await service.run("git_github_pr_action", { ...params, action })).toMatchObject({ kind: "pr", number: 7, draft: action === "draft" });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][0]).toContain("--repo");
});
it("validates mutation arguments before executing gh", async () => {
  const { service, execute } = setup();
  for (const extra of [{ repo: "../repo" }, { number: -1 }, { action: "delete" }])
    await expect(service.run("git_github_pr_action", { ...params, action: "merge", ...extra })).rejects.toThrow();
  await expect(service.run("git_github_work_item_comment", { ...params, body: " ", inReplyTo: "x" })).rejects.toThrow("empty");
  await expect(service.run("git_github_check_details", { ...params, jobId: "../secrets" })).rejects.toThrow("job ID");
  expect(execute).not.toHaveBeenCalled();
});
it("maps check statuses without trusting stale or unknown conclusions", async () => {
  expect(githubCheckState("IN_PROGRESS", "SUCCESS")).toBe("pending"); expect(githubCheckState("NEW_STATUS", "SUCCESS")).toBe("unknown");
  const { service, execute } = setup(); execute.mockResolvedValue(reply({ headRefOid: "sha", statusCheckRollup: [
    { __typename: "CheckRun", name: "tests", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://check" },
    { __typename: "StatusContext", context: "deploy", state: "SUCCESS", targetUrl: "https://deploy" },
  ] }));
  expect(await service.run("git_github_pr_checks", params)).toMatchObject({ headOid: "sha", checks: [{ name: "tests", state: "fail" }, { name: "deploy", state: "pass" }] });
});
it("loads annotations only from a check-run URL scoped to the requested repository", async () => {
  const { service, execute } = setup(); execute.mockResolvedValueOnce(reply({ id: 42, steps: [{ name: "test", status: "completed", conclusion: "failure" }], check_run_url: "https://api.github.com/repos/other/repo/check-runs/5" }));
  expect(await service.run("git_github_check_details", { ...params, jobId: "42" })).toMatchObject({ steps: [{ state: "fail" }], annotations: [], notice: "Error annotations are unavailable. View the full log on GitHub." });
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mockResolvedValueOnce(reply({ id: 42, check_run_url: "https://api.github.com/repos/owner/repo/check-runs/5" }))
    .mockResolvedValueOnce(reply([{ path: "a.ts", start_line: 2, message: "error", annotation_level: "failure" }]));
  expect(await service.run("git_github_check_details", { ...params, jobId: "42" })).toMatchObject({ annotations: [{ path: "a.ts", line: 2, message: "error", level: "failure" }], notice: null });
});
it("shares GraphQL rate-limit backoff and uses the reported reset without replaying mutations", async () => {
  let now = Date.parse("2026-01-01T00:00:00Z"); const execute = vi.fn<GithubRunner>(); const service = new HostGithub(execute, undefined, () => now);
  execute.mockRejectedValueOnce({ stderr: "GraphQL API rate limit exceeded" }).mockResolvedValueOnce(reply({ data: { rateLimit: { remaining: 0, resetAt: "2026-01-01T00:05:00Z" } } }));
  await expect(service.run("git_github_work_item", params)).rejects.toThrow("rate limit");
  await expect(service.run("git_github_pr_action", { ...params, action: "merge" })).rejects.toThrow("rate limit");
  expect(execute).toHaveBeenCalledTimes(2);
  now += 302_000; execute.mockResolvedValueOnce(reply(issue));
  await expect(service.run("git_github_work_item", params)).resolves.toMatchObject({ number: 7 });
});
it("redacts credentials from CLI failures and preserves the last operation as failed", async () => {
  const { service, execute } = setup(); vi.stubEnv("GH_TOKEN", "private-env-token");
  execute.mockRejectedValue({ stderr: "authentication failed private-env-token github_pat_secret" });
  await expect(service.run("git_github_work_item", params)).rejects.toThrow("authentication failed [redacted] [redacted]");
});
it("returns full-context patches from actual Git objects and marks bounded oversized output", async () => {
  const root = mkdtempSync(join(tmpdir(), "omnicode-github-diff-")); cleanup.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
  git("init"); writeFileSync(join(root, "a.txt"), "before\n"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "first"); const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "a.txt"), "after\n"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "second"); const head = git("rev-parse", "HEAD");
  const execute = vi.fn<GithubRunner>().mockResolvedValue(reply({ baseRefOid: base, headRefOid: head, additions: 1, deletions: 1, files: [{ path: "a.txt", additions: 1, deletions: 1 }] }));
  const service = new HostGithub(execute);
  expect(await service.run("git_github_pr_diff", { ...params, cwd: root, fullContext: true })).toMatchObject({ patch: expect.stringContaining("-before\n+after"), truncated: false });
  execute.mockResolvedValueOnce(reply({ files: [], additions: 0, deletions: 0 })).mockRejectedValueOnce(new Error("stdout maxBuffer length exceeded"));
  expect(await service.run("git_github_pr_diff", params)).toMatchObject({ patch: "", truncated: true });
});
