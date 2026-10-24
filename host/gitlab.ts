import { InboxCredentials } from "./inbox-credentials";
import { machineExec, type MachineExecOptions } from "./machine-io";
import type {
  GitlabKind,
  GitlabMrDiff,
  GitlabWorkItem,
  GitlabWorkItemDetails,
  GitlabWorkItemThread,
} from "../src/contracts/gitlab";

type Row = Record<string, unknown>;
type Config = { url: string; token: string };
type GitlabExec = (command: string, args: string[], options?: MachineExecOptions) => Promise<{ stdout: string; stderr: string }>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const field = (value: unknown, key: string) => text(object(value)[key]);
const rows = (value: unknown, label: string): Row[] => {
  if (!Array.isArray(value)) throw new Error(`GitLab did not return ${label}`);
  return value.map(object);
};
const validProject = (value: string) =>
  value.split("/").length >= 2 &&
  value
    .split("/")
    .every(
      (part) =>
        !!part && part !== "." && part !== ".." && !/[\s?#\\]/.test(part),
    );
const project = (value: unknown) => {
  const repo = text(value);
  if (!validProject(repo)) throw new Error("Invalid GitLab project");
  return repo;
};
const kind = (value: unknown): GitlabKind => {
  if (value !== "issue" && value !== "pr")
    throw new Error("Unknown GitLab task kind");
  return value;
};
const number = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid GitLab item number");
  return value;
};
const resource = (kind: GitlabKind) =>
  kind === "pr" ? "merge_requests" : "issues";
const itemPath = (repo: string, kind: GitlabKind, number: number) =>
  `/projects/${encodeURIComponent(repo)}/${resource(kind)}/${number}`;
const noteUrl = (
  config: Config,
  repo: string,
  kind: GitlabKind,
  number: number,
  id: number,
) => `${config.url}/${repo}/-/${resource(kind)}/${number}#note_${id}`;
const person = (value: unknown) => ({
  login: field(value, "username") || field(value, "name"),
  avatarUrl: field(value, "avatar_url"),
});

export function normalizeGitlabUrl(value: unknown): string {
  const raw = text(value) || "https://gitlab.com";
  if (raw.includes("://") && !/^https?:\/\//.test(raw))
    throw new Error("GitLab URL must use HTTP or HTTPS");
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  const rest = candidate.slice(candidate.indexOf("://") + 3);
  if (
    !rest ||
    rest.startsWith("/") ||
    /[@?#\\\s]/.test(rest) ||
    rest
      .split("/")
      .slice(1)
      .some((part) => /^(?:\.|\.\.|%2e|%2e%2e|%2e\.|\.%2e)$/i.test(part))
  )
    throw new Error("GitLab URL is invalid");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("GitLab URL is invalid");
  }
  if (!url.hostname) throw new Error("GitLab URL is invalid");
  return candidate
    .replace(/\/+$/, "")
    .replace(/\/api\/v4$/, "")
    .replace(/\/+$/, "");
}

export function gitlabProjectFromRemote(
  remote: string,
  configuredUrl: string,
): string | undefined {
  const configured = new URL(normalizeGitlabUrl(configuredUrl));
  const value = remote.trim();
  let authority: string, path: string;
  const scheme = value.indexOf("://");
  if (scheme >= 0) {
    const rest = value.slice(scheme + 3),
      slash = rest.indexOf("/");
    if (slash < 0) return;
    authority = rest.slice(0, slash).split("@").at(-1)!;
    path = rest.slice(slash + 1);
  } else {
    const colon = value.indexOf(":");
    if (colon < 0) return;
    authority = value.slice(0, colon).split("@").at(-1)!;
    path = value.slice(colon + 1);
  }
  const host = (value: string) =>
    value.startsWith("[")
      ? value.slice(0, value.indexOf("]") + 1).toLowerCase()
      : value.split(":")[0].toLowerCase();
  if (host(authority) !== configured.hostname.toLowerCase()) return;
  path = path.replace(/^\/+|\/+$/g, "");
  const prefix = configured.pathname.replace(/^\/+|\/+$/g, "");
  if (prefix) {
    if (!path.startsWith(`${prefix}/`)) return;
    path = path.slice(prefix.length + 1);
  }
  path = path.replace(/\.git$/, "");
  return validProject(path) ? path : undefined;
}

function workItem(
  row: Row,
  kind: GitlabKind,
  repo: string,
): GitlabWorkItem | undefined {
  if (
    typeof row.iid !== "number" ||
    !Number.isSafeInteger(row.iid) ||
    row.iid <= 0
  )
    return;
  const title = field(row, "title"),
    state = field(row, "state").toLowerCase();
  const labels = (Array.isArray(row.labels) ? row.labels : [])
    .map((label) =>
      typeof label === "string"
        ? { name: label.trim(), color: "" }
        : {
            name: field(label, "name"),
            color: field(label, "color").replace(/^#+/, ""),
          },
    )
    .filter((label) => label.name);
  const assignees =
    Array.isArray(row.assignees) && row.assignees.length
      ? row.assignees
      : row.assignee && typeof row.assignee === "object"
        ? [row.assignee]
        : [];
  return {
    kind,
    number: row.iid,
    title,
    url: field(row, "web_url"),
    state: ["opened", "reopened"].includes(state) ? "open" : state,
    updatedAt: field(row, "updated_at"),
    labels,
    assignees: assignees.map(person).filter((value) => value.login),
    draft:
      kind === "pr" &&
      (row.draft === true ||
        row.work_in_progress === true ||
        /^(draft|wip):/i.test(title)),
    repo,
    attentionReason: "",
  };
}

export function gitlabMergeRequestDiff(
  value: unknown,
  nextPage = false,
): GitlabMrDiff {
  const result: GitlabMrDiff = {
    additions: 0,
    deletions: 0,
    files: [],
    patch: "",
    truncated: nextPage,
  };
  let bytes = 0;
  for (const row of rows(value, "merge request diffs")) {
    const oldPath = field(row, "old_path"),
      newPath =
        typeof row.new_path === "string" ? row.new_path.trim() : oldPath;
    if (!oldPath && !newPath) continue;
    const diff = typeof row.diff === "string" ? row.diff : "";
    let additions = 0,
      deletions = 0;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    result.additions += additions;
    result.deletions += deletions;
    result.files.push({ path: newPath || oldPath, additions, deletions });
    result.truncated ||= row.too_large === true || row.collapsed === true;
    if (!diff) continue;
    const old = oldPath || newPath,
      next = newPath || oldPath;
    const block = `diff --git a/${old} b/${next}\n${row.new_file === true ? "new file mode 100644\n" : ""}${row.deleted_file === true ? "deleted file mode 100644\n" : ""}${row.renamed_file === true ? `rename from ${old}\nrename to ${next}\n` : ""}--- ${row.new_file === true ? "/dev/null" : `a/${old}`}\n+++ ${row.deleted_file === true ? "/dev/null" : `b/${next}`}\n${diff}${diff.endsWith("\n") ? "" : "\n"}`;
    const size = Buffer.byteLength(block);
    if (bytes + size > 2 * 1024 * 1024) {
      result.truncated = true;
      continue;
    }
    result.patch += block;
    bytes += size;
  }
  return result;
}

class GitlabHttpError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401 || status === 403
        ? "GitLab access token is invalid or lacks permission"
        : `GitLab request failed (${status})`,
    );
  }
}

export class HostGitlab {
  constructor(
    private credentials: InboxCredentials,
    private request: typeof fetch = fetch,
    private exec: GitlabExec = machineExec,
  ) {}
  private config(): Config | undefined {
    const saved = this.credentials.get("gitlab", "gitlab-config.json");
    if (saved == null) return;
    let value: unknown = saved;
    if (typeof saved === "string") {
      try {
        value = JSON.parse(saved);
      } catch {
        throw new Error("GitLab settings are invalid");
      }
    }
    if (typeof object(value).url !== "string" || typeof object(value).token !== "string") {
      throw new Error("GitLab settings are invalid");
    }
    const token = field(value, "token");
    if (!token) return;
    return { url: normalizeGitlabUrl(object(value).url), token };
  }
  private async api(
    config: Config,
    path: string,
    body?: string,
  ): Promise<{ value: unknown; nextPage: boolean }> {
    let response: Response;
    try {
      response = await this.request(`${config.url}/api/v4${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "PRIVATE-TOKEN": config.token,
          "User-Agent": "OmniCode",
          ...(body !== undefined
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Could not reach GitLab");
    }
    if (!response.ok) throw new GitlabHttpError(response.status);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("GitLab returned invalid JSON");
    }
    return { value, nextPage: !!response.headers.get("x-next-page")?.trim() };
  }
  private async repo(config: Config, cwd: unknown): Promise<string> {
    if (typeof cwd !== "string" || !cwd.trim())
      throw new Error("Missing GitLab project directory");
    let stdout: string;
    try {
      ({ stdout } = await this.exec(
        "git",
        ["config", "--get-regexp", "^remote\\..*\\.url$"],
        { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
      ));
    } catch (error) {
      if (object(error).code === 1) stdout = "";
      else throw new Error("Could not read git remotes");
    }
    const matches = stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^(\S+)\s+(.+)$/.exec(line);
      if (!match) return [];
      const repo = gitlabProjectFromRemote(match[2], config.url);
      return repo ? [{ origin: match[1] === "remote.origin.url", repo }] : [];
    });
    const found = matches.find((match) => match.origin) ?? matches[0];
    if (!found) throw new Error("No GitLab remote matches the configured host");
    return found.repo;
  }
  async run(command: string, params: Row = {}): Promise<unknown> {
    if (command === "gitlab_status") {
      const config = this.config();
      return { connected: !!config, url: config?.url ?? "https://gitlab.com" };
    }
    if (command === "gitlab_set_config") {
      const url = normalizeGitlabUrl(params.url),
        token = text(params.token);
      if (token.length > 8192 || /[\r\n\0]/.test(token))
        throw new Error("Invalid GitLab access token");
      if (token) {
        const response = await this.api({ url, token }, "/user");
        if (!Number.isSafeInteger(object(response.value).id))
          throw new Error("GitLab did not return the current user");
      }
      this.credentials.set("gitlab", token ? { url, token } : null);
      return { connected: !!token, url };
    }
    const config = this.config();
    if (!config) throw new Error("Connect GitLab in Settings");
    if (command === "gitlab_repo") return this.repo(config, params.cwd);
    if (
      command === "gitlab_list_work_items" ||
      command === "gitlab_list_todos"
    ) {
      const itemKind = kind(params.kind),
        limit =
          typeof params.limit === "number" && Number.isFinite(params.limit)
            ? Math.max(1, Math.min(100, Math.floor(params.limit)))
            : 40;
      if (command === "gitlab_list_todos") {
        const response = await this.api(
          config,
          `/todos?state=pending&type=${itemKind === "pr" ? "MergeRequest" : "Issue"}&per_page=${limit}`,
        );
        return rows(response.value, "to-do items").flatMap((row) => {
          const repo = field(row.project, "path_with_namespace");
          if (!validProject(repo)) return [];
          const item = workItem(object(row.target), itemKind, repo);
          return item
            ? [
                {
                  ...item,
                  url: item.url || field(row, "target_url"),
                  updatedAt: item.updatedAt || field(row, "created_at"),
                  attentionReason: field(row, "action_name"),
                },
              ]
            : [];
        });
      }
      const repo = await this.repo(config, params.cwd),
        state = text(params.state).toLowerCase() === "all" ? "all" : "opened";
      const response = await this.api(
        config,
        `/projects/${encodeURIComponent(repo)}/${resource(itemKind)}?state=${state}&order_by=updated_at&sort=desc&per_page=${limit}&with_labels_details=true&scope=${params.assignedToMe === true ? "assigned_to_me" : "all"}`,
      );
      return rows(response.value, "work items").flatMap((row) => {
        const item = workItem(row, itemKind, repo);
        return item ? [item] : [];
      });
    }
    const repo = project(params.repo),
      itemKind = command === "gitlab_mr_diff" ? "pr" : kind(params.kind),
      itemNumber = number(params.number),
      path = itemPath(repo, itemKind, itemNumber);
    if (command === "gitlab_work_item_details") {
      const { value } = await this.api(config, path);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("GitLab did not return that item");
      const author = person(object(value).author);
      return {
        body: field(value, "description"),
        author: author.login,
        authorAvatarUrl: author.avatarUrl,
        baseRefName: itemKind === "pr" ? field(value, "target_branch") : "",
        headRefName: itemKind === "pr" ? field(value, "source_branch") : "",
        reviewDecision: "",
      } satisfies GitlabWorkItemDetails;
    }
    if (command === "gitlab_work_item_thread") {
      const response = await this.api(
        config,
        `${path}/notes?order_by=created_at&sort=desc&per_page=100`,
      );
      const comments = rows(response.value, "comments")
        .filter(
          (row) =>
            row.system !== true &&
            typeof row.id === "number" &&
            Number.isSafeInteger(row.id),
        )
        .map((row) => {
          const author = person(row.author);
          return {
            id: String(row.id),
            kind: "comment",
            author: author.login,
            authorAvatarUrl: author.avatarUrl,
            body: field(row, "body"),
            createdAt: field(row, "created_at"),
            url: noteUrl(config, repo, itemKind, itemNumber, row.id as number),
            state: "",
            path: "",
            line: null,
            resolved: row.resolved === true,
            threadId: "",
            replies: [],
          };
        })
        .reverse();
      return {
        comments,
        truncated: response.nextPage,
        reviewDecision: "",
        baseRefName: "",
        headRefName: "",
      } satisfies GitlabWorkItemThread;
    }
    if (command === "gitlab_work_item_comment") {
      const body = text(params.body);
      if (!body) throw new Error("Comment cannot be empty");
      const { value } = await this.api(
        config,
        `${path}/notes`,
        new URLSearchParams({ body }).toString(),
      );
      const id = object(value).id;
      if (typeof id !== "number" || !Number.isSafeInteger(id))
        throw new Error("GitLab did not return a comment");
      return noteUrl(config, repo, itemKind, itemNumber, id);
    }
    if (command === "gitlab_mr_diff") {
      let response: { value: unknown; nextPage: boolean };
      try {
        response = await this.api(config, `${path}/diffs?per_page=100`);
      } catch (error) {
        if (!(error instanceof GitlabHttpError) || error.status !== 404)
          throw error;
        response = await this.api(config, `${path}/changes`);
        return gitlabMergeRequestDiff(
          object(response.value).changes,
          response.nextPage || object(response.value).overflow === true,
        );
      }
      return gitlabMergeRequestDiff(response.value, response.nextPage);
    }
    throw new Error("Unsupported GitLab operation");
  }
}
