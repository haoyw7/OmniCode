import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxCredentials } from "./inbox-credentials";
import {
  HostGitlab,
  gitlabMergeRequestDiff,
  gitlabProjectFromRemote,
  normalizeGitlabUrl,
} from "./gitlab";
import type { machineExec } from "./machine-io";

const cleanup: string[] = [];
afterEach(() => {
  for (const directory of cleanup.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-gitlab-"));
  cleanup.push(directory);
  const desktop = join(directory, "desktop");
  mkdirSync(desktop);
  const credentials = new InboxCredentials(directory, () => desktop);
  const request = vi.fn<typeof fetch>(),
    exec = vi.fn<typeof machineExec>();
  const service = new HostGitlab(credentials, request, exec);
  return { desktop, credentials, request, exec, service };
}
const response = (value: unknown, status = 200, nextPage = "") =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "x-next-page": nextPage },
  });
const config = { url: "https://git.example/gitlab", token: "private-token" };

it("imports desktop credentials once and keeps disconnect durable without modifying the source", async () => {
  const { desktop, credentials, request, service } = setup();
  writeFileSync(join(desktop, "gitlab-config.json"), JSON.stringify(config));
  expect(await service.run("gitlab_status")).toEqual({
    connected: true,
    url: config.url,
  });
  request.mockResolvedValue(response([]));
  expect(await service.run("gitlab_list_todos", { kind: "issue" })).toEqual([]);
  expect(request.mock.calls[0][1]).toMatchObject({
    headers: { "PRIVATE-TOKEN": config.token },
    redirect: "error",
  });
  await service.run("gitlab_set_config", { url: config.url, token: "" });
  expect(
    await new HostGitlab(credentials, request).run("gitlab_status"),
  ).toEqual({ connected: false, url: "https://gitlab.com" });
  expect(
    JSON.parse(readFileSync(join(desktop, "gitlab-config.json"), "utf8")),
  ).toEqual(config);
});

it("validates replacement credentials and never echoes HTTP or transport secrets", async () => {
  const { credentials, request, service } = setup();
  credentials.set("gitlab", config);
  request.mockResolvedValueOnce(response({ id: 1 }));
  expect(
    await service.run("gitlab_set_config", {
      url: "git.example/gitlab/api/v4/",
      token: "new-token",
    }),
  ).toEqual({ connected: true, url: config.url });
  request.mockResolvedValueOnce(
    response({ message: "new-token private response" }, 400),
  );
  await expect(
    service.run("gitlab_set_config", { url: config.url, token: "bad-token" }),
  ).rejects.toThrow("GitLab request failed (400)");
  expect(credentials.get("gitlab", "gitlab-config.json")).toEqual({
    ...config,
    token: "new-token",
  });
  request.mockRejectedValueOnce(new Error("private-token in transport"));
  await expect(
    service.run("gitlab_list_todos", { kind: "issue" }),
  ).rejects.toThrow("Could not reach GitLab");
});

it("reports malformed imported credentials instead of silently replacing them", async () => {
  const { desktop, request, service } = setup();
  writeFileSync(join(desktop, "gitlab-config.json"), JSON.stringify({ url: config.url }));
  await expect(service.run("gitlab_status")).rejects.toThrow("GitLab settings are invalid");
  expect(request).not.toHaveBeenCalled();
  expect(JSON.parse(readFileSync(join(desktop, "gitlab-config.json"), "utf8"))).toEqual({ url: config.url });
});

it("normalizes configured URLs and matches nested repositories without confusing host or path prefixes", () => {
  expect(normalizeGitlabUrl("git.example/gitlab/api/v4/")).toBe(config.url);
  for (const url of [
    "file:///tmp/x",
    "https://user:secret@git.example",
    "https://git.example/%2e%2e",
    "https://git.example/a?token=x",
    "https://git.example/a#x",
  ])
    expect(() => normalizeGitlabUrl(url)).toThrow();
  expect(
    gitlabProjectFromRemote(
      "ssh://git@git.example:2222/gitlab/group/sub/repo.git",
      config.url,
    ),
  ).toBe("group/sub/repo");
  expect(
    gitlabProjectFromRemote(
      "git@git.example:gitlab/group/repo.git",
      config.url,
    ),
  ).toBe("group/repo");
  expect(
    gitlabProjectFromRemote(
      "https://other.example/gitlab/group/repo.git",
      config.url,
    ),
  ).toBeUndefined();
  expect(
    gitlabProjectFromRemote(
      "https://git.example/gitlab-other/group/repo.git",
      config.url,
    ),
  ).toBeUndefined();
});

it("uses the selected machine's git remotes, prefers origin and preserves issue filters and shapes", async () => {
  const { credentials, request, exec, service } = setup();
  credentials.set("gitlab", config);
  exec.mockResolvedValue({
    stdout:
      "remote.upstream.url git@git.example:gitlab/upstream/repo.git\nremote.origin.url ssh://git@git.example:2222/gitlab/team/repo.git\n",
    stderr: "",
  });
  request.mockResolvedValue(
    response([
      {
        iid: 7,
        title: "Draft: Fix",
        state: "opened",
        labels: ["bug", { name: "test", color: "#123456" }],
        assignee: { username: "ada", avatar_url: "avatar" },
      },
    ]),
  );
  expect(
    await service.run("gitlab_list_work_items", {
      cwd: "/workspace",
      kind: "pr",
      state: "all",
      limit: 500,
      assignedToMe: true,
    }),
  ).toEqual([
    {
      kind: "pr",
      number: 7,
      title: "Draft: Fix",
      state: "open",
      url: "",
      updatedAt: "",
      labels: [
        { name: "bug", color: "" },
        { name: "test", color: "123456" },
      ],
      assignees: [{ login: "ada", avatarUrl: "avatar" }],
      draft: true,
      repo: "team/repo",
      attentionReason: "",
    },
  ]);
  expect(exec.mock.calls[0]).toEqual([
    "git",
    ["config", "--get-regexp", "^remote\\..*\\.url$"],
    {
      cwd: "/workspace",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  ]);
  expect(String(request.mock.calls[0][0])).toContain(
    "/projects/team%2Frepo/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100&with_labels_details=true&scope=assigned_to_me",
  );
});

it("keeps todo fallback fields, details and chronological non-system comment history", async () => {
  const { credentials, request, service } = setup();
  credentials.set("gitlab", config);
  request.mockResolvedValueOnce(
    response([
      {
        project: { path_with_namespace: "team/repo" },
        target: { iid: 7, title: "Need review" },
        target_url: "todo-url",
        created_at: "today",
        action_name: "mentioned",
      },
    ]),
  );
  expect(await service.run("gitlab_list_todos", { kind: "pr" })).toMatchObject([
    {
      repo: "team/repo",
      url: "todo-url",
      updatedAt: "today",
      attentionReason: "mentioned",
    },
  ]);
  request.mockResolvedValueOnce(
    response({
      description: "Body",
      author: { username: "ada" },
      target_branch: "main",
      source_branch: "fix",
    }),
  );
  expect(
    await service.run("gitlab_work_item_details", {
      repo: "team/repo",
      kind: "pr",
      number: 7,
    }),
  ).toEqual({
    body: "Body",
    author: "ada",
    authorAvatarUrl: "",
    baseRefName: "main",
    headRefName: "fix",
    reviewDecision: "",
  });
  request.mockResolvedValueOnce(
    response(
      [
        { id: 4, body: "system", system: true },
        { id: 3, body: "later" },
        { id: 2, body: "first", author: { name: "Ada" }, resolved: true },
      ],
      200,
      "2",
    ),
  );
  expect(
    await service.run("gitlab_work_item_thread", {
      repo: "team/repo",
      kind: "pr",
      number: 7,
    }),
  ).toMatchObject({
    comments: [
      {
        id: "2",
        body: "first",
        author: "Ada",
        resolved: true,
        url: `${config.url}/team/repo/-/merge_requests/7#note_2`,
      },
      { id: "3", body: "later" },
    ],
    truncated: true,
  });
});

it("validates comments before sending and retries old diff endpoints only for a 404", async () => {
  const { credentials, request, service } = setup();
  credentials.set("gitlab", config);
  await expect(
    service.run("gitlab_work_item_comment", {
      repo: "team/repo",
      kind: "issue",
      number: 1,
      body: " ",
    }),
  ).rejects.toThrow("Comment cannot be empty");
  await expect(
    service.run("gitlab_work_item_comment", {
      repo: "../bad",
      kind: "issue",
      number: 1,
      body: "body",
    }),
  ).rejects.toThrow("Invalid GitLab project");
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(response({ id: 8 }));
  expect(
    await service.run("gitlab_work_item_comment", {
      repo: "team/repo",
      kind: "issue",
      number: 1,
      body: " text & detail ",
    }),
  ).toBe(`${config.url}/team/repo/-/issues/1#note_8`);
  expect(request.mock.calls[0][1]?.body).toBe("body=text+%26+detail");
  request
    .mockResolvedValueOnce(response({}, 404))
    .mockResolvedValueOnce(
      response({
        changes: [
          { old_path: "a", new_path: "a", diff: "@@ -1 +1 @@\n-old\n+new" },
        ],
        overflow: true,
      }),
    );
  expect(
    await service.run("gitlab_mr_diff", { repo: "team/repo", number: 1 }),
  ).toMatchObject({ additions: 1, deletions: 1, truncated: true });
  expect(String(request.mock.calls[2][0])).toMatch(/\/changes$/);
  request.mockResolvedValueOnce(response({ message: "secret" }, 403));
  await expect(
    service.run("gitlab_mr_diff", { repo: "team/repo", number: 1 }),
  ).rejects.toThrow("GitLab access token is invalid or lacks permission");
  expect(request).toHaveBeenCalledTimes(4);
});

it("keeps full patch whitespace, rename/add/delete markers and UTF-8 byte limits", () => {
  const result = gitlabMergeRequestDiff([
    {
      old_path: "old",
      new_path: "new",
      renamed_file: true,
      diff: "@@ -1 +1 @@\n-a\n+  b  ",
    },
    { new_path: "added", new_file: true, diff: "+x\n" },
    { old_path: "removed", deleted_file: true, diff: "-x\n" },
  ]);
  expect(result).toMatchObject({
    additions: 2,
    deletions: 2,
    truncated: false,
  });
  expect(result.patch).toContain(
    "rename from old\nrename to new\n--- a/old\n+++ b/new\n@@ -1 +1 @@\n-a\n+  b  \n",
  );
  expect(result.patch).toContain("--- /dev/null\n+++ b/added");
  expect(result.patch).toContain("--- a/removed\n+++ /dev/null");
  const large = gitlabMergeRequestDiff([
    { new_path: "large", diff: `+${"界".repeat(800_000)}` },
    { new_path: "small", diff: "+x" },
  ]);
  expect(large.truncated).toBe(true);
  expect(large.files).toHaveLength(2);
  expect(large.patch).not.toContain("b/large");
  expect(large.patch).toContain("b/small");
});
