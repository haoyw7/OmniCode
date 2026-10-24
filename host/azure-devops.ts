import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxCredentials } from "./inbox-credentials";
import { currentMachineIO, localMachineIO } from "./machine-io";
import type { AzureDevOpsKind, AzureDevOpsWorkItem, AzureDevOpsWorkItemComment, AzureDevOpsWorkItemThread, AzureDevOpsMrDiff } from "../src/contracts/azureDevOps";

type Row = Record<string, unknown>;
type Config = { url: string; token: string };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const field = (value: unknown, key: string) => str(object(value)[key]);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
const rows = (value: unknown, key: string, label: string): Row[] => {
  if (!Array.isArray(object(value)[key])) throw new Error(`Azure DevOps did not return ${label}`);
  return (object(value)[key] as unknown[]).map(object);
};
const enc = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const shortRef = (value: unknown) => str(value).replace(/^refs\/heads\//, "");
const person = (value: unknown) => ({ login: field(value, "displayName"), avatarUrl: field(value, "imageUrl") });
const MAX_FILE = 512 * 1024;
const MAX_DIFF = 2 * 1024 * 1024;
const version = "api-version=7.1";
const witVersion = "api-version=7.1-preview.4";

export function normalizeAzureDevOpsUrl(value: unknown): string {
  const raw = str(value).replace(/\/+$/, "");
  if (!raw) throw new Error("Enter your Azure DevOps organization URL (e.g. https://dev.azure.com/myorg)");
  if (/[\s?#\\]/.test(raw)) throw new Error("Azure DevOps URL is invalid");
  const full = raw.includes("://") ? raw : /[./]/.test(raw) ? `https://${raw}` : `https://dev.azure.com/${raw}`;
  if (!full.startsWith("https://")) throw new Error("Azure DevOps URL must use HTTPS");
  let url: URL;
  try { url = new URL(full); } catch { throw new Error("Azure DevOps URL is invalid"); }
  if (!url.hostname || url.username || url.password) throw new Error("Azure DevOps URL is invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  const suffix = segments.findIndex(segment => /^_(apis|git)$/i.test(segment));
  if (suffix >= 0) segments.splice(suffix);
  if (["dev.azure.com", "ssh.dev.azure.com"].includes(url.host)) {
    if (!segments[0]) throw new Error("Azure DevOps URL must include your organization (e.g. https://dev.azure.com/myorg)");
    return `https://dev.azure.com/${segments[0]}`;
  }
  if (url.host.endsWith(".visualstudio.com")) {
    const organization = url.host.slice(0, -".visualstudio.com".length);
    if (!organization || organization.includes(".")) throw new Error("Azure DevOps URL is invalid");
    return `https://dev.azure.com/${organization}`;
  }
  if (!segments.length) throw new Error("Azure DevOps URL must include your organization or collection");
  return `${url.origin}/${segments.slice(0, 2).join("/")}`;
}

function repoParts(input: unknown): [string, string] {
  const parts = str(input).split("/");
  if (parts.length !== 2 || parts.some(part => !part.trim() || part === "." || part === ".." || /[?#\\\x00-\x1f\x7f]/.test(part))) throw new Error("Invalid Azure DevOps repository");
  return parts as [string, string];
}
function witProject(input: unknown): string {
  const project = str(input).split("/")[0].trim();
  if (!project || project === "." || project === ".." || /[\x00-\x1f\x7f]/.test(project)) throw new Error("Invalid Azure DevOps project");
  return project;
}
export function azureRepoFromRemote(input: string, organizationUrl: string): string | undefined {
  const expected = normalizeAzureDevOpsUrl(organizationUrl).toLowerCase();
  let organization: string; let project: string; let repository: string;
  const decode = (value: string) => { try { return decodeURIComponent(value).trim().replace(/\.git$/, ""); } catch { return value.trim().replace(/\.git$/, ""); } };
  const ssh = input.trim().match(/^git@ssh\.dev\.azure\.com:(?:v3\/)?([^/]+)\/([^/]+)\/(.+)$/i);
  if (ssh) { organization = `https://dev.azure.com/${ssh[1]}`; project = decode(ssh[2]); repository = decode(ssh[3]).split("/").at(-1)!; }
  else {
    let url: URL; try { url = new URL(input.trim()); } catch { return undefined; }
    const parts = url.pathname.split("/").filter(Boolean).map(decode);
    const gitIndex = parts.findIndex(part => part.toLowerCase() === "_git");
    if (gitIndex < 1 || gitIndex + 1 >= parts.length) return undefined;
    project = parts[gitIndex - 1]; repository = parts.slice(gitIndex + 1).join("/").replace(/\.git$/, "");
    if (url.host === "dev.azure.com" && gitIndex === 2) organization = `https://dev.azure.com/${parts[0]}`;
    else if (url.host.endsWith(".visualstudio.com") && gitIndex === 1) organization = `https://dev.azure.com/${url.host.slice(0, -".visualstudio.com".length)}`;
    else if (gitIndex >= 2) organization = `https://${url.host}/${parts.slice(0, gitIndex - 1).join("/")}`;
    else return undefined;
  }
  if (organization.toLowerCase() !== expected) return undefined;
  try { return repoParts(`${project}/${repository}`).join("/"); } catch { return undefined; }
}

function prUrl(config: Config, repo: string, number: number) {
  const [project, name] = repoParts(repo);
  return `${config.url}/${project.trim()}/_git/${name.trim()}/pullrequest/${number}`;
}
function pr(row: Row, repo: string, config: Config): AzureDevOpsWorkItem | undefined {
  const number = integer(row.pullRequestId); if (number <= 0) return undefined;
  const rawState = field(row, "status").toLowerCase();
  const assignees = (Array.isArray(row.reviewers) ? row.reviewers : []).map(person).filter(value => value.login);
  const author = person(row.createdBy); if (author.login && !assignees.some(value => value.login === author.login)) assignees.push(author);
  const remote = field(row.repository, "remoteUrl");
  return { kind: "pr", number, title: field(row, "title"),
    url: field(object(row._links).web, "href") || (remote ? `${remote.replace(/\/+$/, "")}/pullrequest/${number}` : prUrl(config, repo, number)),
    state: ({ active: "open", completed: "merged", abandoned: "closed" } as Row)[rawState] as string || rawState,
    updatedAt: field(row, "closedDate") || field(row, "creationDate"),
    labels: (Array.isArray(row.labels) ? row.labels : []).map(value => ({ name: field(value, "name"), color: "" })).filter(value => value.name),
    assignees, draft: row.isDraft === true, repo, attentionReason: "" };
}
function wit(row: Row): AzureDevOpsWorkItem | undefined {
  const number = integer(row.id); if (number <= 0 || !row.fields) return undefined;
  const fields = object(row.fields); const rawState = field(fields, "System.State").toLowerCase();
  const state = ["new", "active", "to do", "doing", "in progress", "resolved", "proposed", "approved", "committed"].includes(rawState) ? "open"
    : ["closed", "done", "removed", "abandoned", "cut"].includes(rawState) ? "closed" : rawState;
  const assignee = person(fields["System.AssignedTo"]);
  return { kind: "issue", number, title: field(fields, "System.Title"), url: field(object(row._links).html, "href"), state,
    updatedAt: field(fields, "System.ChangedDate") || field(fields, "System.CreatedDate"),
    labels: field(fields, "System.Tags").split(";").map(name => ({ name: name.trim(), color: "" })).filter(value => value.name),
    assignees: assignee.login ? [assignee] : [], draft: false, repo: field(fields, "System.TeamProject"), attentionReason: "" };
}
const baseComment = (): AzureDevOpsWorkItemComment => ({ id: "", kind: "comment", author: "", authorAvatarUrl: "", body: "", createdAt: "", url: "", state: "", path: "", line: null, resolved: false, threadId: "", replies: [] });
const emptyThread = (): AzureDevOpsWorkItemThread => ({ comments: [], truncated: false, reviewDecision: "", baseRefName: "", headRefName: "" });

export class HostAzureDevOps {
  constructor(private credentials: InboxCredentials, private request: typeof fetch = fetch) {}
  private config(): Config | undefined {
    const stored = this.credentials.get("azuredevops", "azure-devops-config.json"); if (!stored) return undefined;
    let value: Row; try { value = object(typeof stored === "string" ? JSON.parse(stored) : stored); } catch { throw new Error("Azure DevOps settings are invalid"); }
    if (!str(value.token)) return undefined;
    return { url: normalizeAzureDevOpsUrl(value.url), token: str(value.token) };
  }
  private async http(config: Config, path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try { response = await this.request(config.url + path, { method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Basic ${Buffer.from(`:${config.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json", "User-Agent": "OmniCode" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error("Could not reach Azure DevOps"); }
    if ([203, 401, 403].includes(response.status)) throw new Error("Azure DevOps personal access token is invalid or lacks permission");
    if (response.status === 404) throw new Error("Azure DevOps did not find that item");
    if (!response.ok) throw new Error(`Azure DevOps request failed (${response.status})`);
    return response;
  }
  private async api(config: Config, path: string, body?: unknown) {
    const response = await this.http(config, path, body);
    let value: Row; try { value = object(await response.json()); } catch { throw new Error("Azure DevOps returned invalid JSON"); }
    return { value, truncated: !!response.headers.get("x-ms-continuationtoken")?.trim() };
  }
  private async me(config: Config): Promise<string> {
    const { value } = await this.api(config, "/_apis/connectionData?api-version=7.1-preview.1");
    const id = field(value.authenticatedUser, "id") || field(value.authorizedUser, "id");
    if (!id) throw new Error("Azure DevOps did not return the current user"); return id;
  }
  private async repo(config: Config, cwd: string): Promise<string> {
    const io = currentMachineIO(); let output: string;
    try { output = (await io.exec("git", ["config", "--get-regexp", "^remote\\..*\\.url$"], { cwd, windowsHide: true, timeout: 20_000 })).stdout; }
    catch (error) { if ((error as { code?: number }).code === 1) output = ""; else throw new Error("Could not read git remotes"); }
    const matches = output.split(/\r?\n/).flatMap(line => {
      const parts = line.match(/^(\S+)\s+(.+)$/); if (!parts) return [];
      const repo = azureRepoFromRemote(parts[2], config.url); return repo ? [{ repo, origin: parts[1] === "remote.origin.url" }] : [];
    });
    const result = matches.find(value => value.origin) ?? matches[0];
    if (!result) throw new Error("No Azure DevOps remote matches the configured organization"); return result.repo;
  }
  private async workItems(config: Config, project: string | undefined, assigned: boolean, state: string, limit: number) {
    const clauses: string[] = [];
    if (project) clauses.push(`[System.TeamProject] = '${project.replace(/'/g, "''")}'`);
    if (assigned) clauses.push("[System.AssignedTo] = @me");
    if (state.toLowerCase() !== "all") clauses.push("[System.State] NOT IN ('Closed', 'Done', 'Removed')");
    if (!clauses.length) clauses.push("[System.Id] > 0");
    const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
    const ids = rows((await this.api(config, `/_apis/wit/wiql?$top=${limit}&${version}`, { query })).value, "workItems", "work items")
      .map(value => integer(value.id)).filter(value => value > 0).slice(0, limit);
    if (!ids.length) return [];
    const fields = "System.Id,System.Title,System.State,System.ChangedDate,System.CreatedDate,System.AssignedTo,System.Tags,System.TeamProject";
    return rows((await this.api(config, `/_apis/wit/workitems?ids=${ids.join(",")}&fields=${fields}&$expand=relations&${version}`)).value, "value", "work items")
      .map(wit).filter((value): value is AzureDevOpsWorkItem => !!value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async run(command: string, params: Row = {}): Promise<unknown> {
    const publicStatus = (config?: Config) => ({ connected: !!config, url: config?.url ?? "", organization: config?.url.toLowerCase() ?? "" });
    if (command === "azure_devops_status") return publicStatus(this.config());
    if (command === "azure_devops_set_config") {
      const url = normalizeAzureDevOpsUrl(params.url); const token = str(params.token);
      if (token.length > 8192 || /[\r\n\0]/.test(token)) throw new Error("Azure DevOps settings are invalid");
      if (!token) { this.credentials.set("azuredevops", null); return { connected: false, url, organization: url.toLowerCase() }; }
      const config = { url, token }; await this.me(config); this.credentials.set("azuredevops", config); return publicStatus(config);
    }
    const config = this.config(); if (!config) throw new Error("Connect Azure DevOps in Settings");
    if (command === "azure_devops_repo") return this.repo(config, str(params.cwd));
    const kind = command === "azure_devops_mr_diff" ? "pr" : str(params.kind) as AzureDevOpsKind;
    if (!["issue", "pr"].includes(kind)) throw new Error("Unknown Azure DevOps task kind");
    const limit = typeof params.limit === "number" && Number.isFinite(params.limit) ? Math.max(1, Math.min(100, Math.floor(params.limit))) : 40;
    if (["azure_devops_list_work_items", "azure_devops_list_todos"].includes(command)) {
      const todos = command === "azure_devops_list_todos";
      const repo = todos ? undefined : await this.repo(config, str(params.cwd));
      if (kind === "issue") {
        const items = await this.workItems(config, repo ? repoParts(repo)[0] : undefined, todos || params.assignedToMe === true, todos ? "open" : str(params.state), limit);
        return todos ? items.map(value => ({ ...value, attentionReason: "assigned" })) : items;
      }
      const reviewer = todos || params.assignedToMe === true ? `&searchCriteria.reviewerId=${enc(await this.me(config))}` : "";
      const statuses = !todos && str(params.state).toLowerCase() === "all" ? ["active", "completed", "abandoned"] : ["active"];
      const prefix = repo ? `/${repoParts(repo).map(enc).join("/_apis/git/repositories/")}` : "/_apis/git";
      const items: AzureDevOpsWorkItem[] = [];
      for (const status of statuses) {
        const response = await this.api(config, `${prefix}/pullrequests?searchCriteria.status=${status}${reviewer}&$top=${Math.min(100, statuses.length > 1 ? limit * 2 : limit)}&${version}`);
        for (const row of rows(response.value, "value", "pull requests")) {
          const ownRepo = repo || (field(object(row.repository).project, "name") && field(row.repository, "name") ? `${field(object(row.repository).project, "name")}/${field(row.repository, "name")}` : "");
          if (!ownRepo) continue; const item = pr(row, ownRepo, config); if (item) items.push(todos ? { ...item, attentionReason: "review_requested" } : item);
        }
      }
      return statuses.length > 1 ? items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit) : items;
    }
    const number = integer(params.number); if (number <= 0) throw new Error("Invalid Azure DevOps item number");
    const repo = str(params.repo);
    if (command === "azure_devops_mr_diff") return this.diff(config, repo, number);
    const prefix = kind === "pr" ? `/${repoParts(repo).map(enc).join("/_apis/git/repositories/")}/pullrequests/${number}` : command === "azure_devops_work_item_details" ? "" : `/${enc(witProject(repo))}/_apis/wit/workitems/${number}`;
    if (command === "azure_devops_work_item_details") {
      const { value } = await this.api(config, kind === "pr" ? `${prefix}?${version}` : `/_apis/wit/workitems/${number}?$expand=relations&${version}`);
      if (kind === "issue" && !value.fields) throw new Error("Azure DevOps did not return that work item");
      const creator = kind === "pr" ? value.createdBy : object(value.fields)["System.CreatedBy"];
      return { body: kind === "pr" ? field(value, "description") : field(value.fields, "System.Description"), author: field(creator, "displayName"),
        authorAvatarUrl: field(creator, "imageUrl") || (kind === "pr" ? field(object(object(creator)._links).avatar, "href") : ""),
        baseRefName: kind === "pr" ? shortRef(value.targetRefName) : "", headRefName: kind === "pr" ? shortRef(value.sourceRefName) : "", reviewDecision: "" };
    }
    if (command === "azure_devops_work_item_comment") {
      const body = str(params.body); if (!body) throw new Error("Comment cannot be empty");
      const response = await this.api(config, `${prefix}/${kind === "pr" ? `threads?${version}` : `comments?${witVersion}`}`,
        kind === "pr" ? { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 } : { text: body });
      return kind === "pr" ? prUrl(config, repo, number) : field(response.value, "url");
    }
    if (command === "azure_devops_work_item_thread") {
      const response = await this.api(config, `${prefix}/${kind === "pr" ? `threads?${version}` : `comments?${witVersion}`}`);
      const result = emptyThread(); result.truncated = response.truncated;
      if (kind === "pr") {
        for (const thread of rows(response.value, "value", "comments")) {
          const threadId = integer(thread.id) ? String(thread.id) : "";
          for (const row of Array.isArray(thread.comments) ? thread.comments.map(object) : []) {
            if (row.isDeleted === true || !field(row, "content")) continue;
            const id = integer(row.id) ? String(row.id) : "";
            result.comments.push({ ...baseComment(), id: threadId ? `${threadId}-${id}` : id, author: field(row.author, "displayName"), authorAvatarUrl: field(row.author, "imageUrl"),
              body: field(row, "content"), createdAt: field(row, "publishedDate") || field(row, "lastUpdatedDate"), url: prUrl(config, repo, number),
              resolved: ["fixed", "closed", "resolved"].includes(field(thread, "status").toLowerCase()), threadId });
          }
        }
      } else {
        for (const row of rows(response.value, "comments", "comments")) {
          const id = integer(row.commentId ?? row.id); if (!id || !field(row, "text")) continue;
          result.comments.push({ ...baseComment(), id: String(id), author: field(row.createdBy, "displayName"), authorAvatarUrl: field(row.createdBy, "imageUrl"), body: field(row, "text"), createdAt: field(row, "createdDate"), url: field(row, "url") });
        }
        result.truncated ||= integer(response.value.totalCount) > result.comments.length;
      }
      result.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); return result;
    }
    throw new Error("Unsupported Azure DevOps operation");
  }

  private async content(config: Config, prefix: string, path: string, sha: string): Promise<Buffer | "binary" | "large" | null> {
    let response: Response;
    try { response = await this.http(config, `${prefix}/items?path=/${path.split("/").map(enc).join("/")}&versionDescriptor.version=${enc(sha)}&versionDescriptor.versionType=commit&includeContent=true&${version}`); }
    catch (error) { if ((error as Error).message === "Azure DevOps did not find that item") return null; throw error; }
    const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_FILE) { await reader.cancel(); return "large"; } chunks.push(chunk.value); } }
    finally { reader.releaseLock(); }
    let bytes = Buffer.concat(chunks);
    try { const value = object(JSON.parse(bytes.toString("utf8"))); if (value.isTruncated === true) return "large"; if (typeof value.content === "string") bytes = Buffer.from(value.content); } catch { /* Raw file bytes. */ }
    return bytes.subarray(0, 8000).includes(0) ? "binary" : bytes;
  }
  private async diff(config: Config, repo: string, number: number): Promise<AzureDevOpsMrDiff> {
    const prefix = `/${repoParts(repo).map(enc).join("/_apis/git/repositories/")}`;
    const result: AzureDevOpsMrDiff = { additions: 0, deletions: 0, files: [], patch: "", truncated: false };
    const iterations = (await this.api(config, `${prefix}/pullrequests/${number}/iterations?${version}`)).value;
    const latest = (Array.isArray(iterations.value) ? iterations.value.map(object) : []).filter(value => integer(value.id) > 0).sort((a, b) => integer(b.id) - integer(a.id))[0];
    if (!latest) return result;
    const source = field(latest.sourceRefCommit, "commitId"); const base = field(latest.commonRefCommit, "commitId") || field(latest.targetRefCommit, "commitId");
    if (!source || !base) return result;
    const response = await this.api(config, `${prefix}/pullrequests/${number}/iterations/${latest.id}/changes?$top=100&${version}`);
    const changes = new Map<string, string>();
    for (const entry of Array.isArray(response.value.changeEntries) ? response.value.changeEntries.map(object) : []) {
      const path = field(entry.item, "path").replace(/^\/+/, ""); if (!path || object(entry.item).isFolder === true) continue;
      if (!changes.has(path)) changes.set(path, field(entry, "changeType").toLowerCase());
    }
    result.files = [...changes.keys()].sort().map(path => ({ path, additions: 0, deletions: 0 })); result.truncated = response.truncated;
    let hunked = 0;
    for (const file of result.files) {
      if (hunked >= 40) { result.truncated = true; break; }
      try {
        const kind = changes.get(file.path);
        const old = kind === "add" ? null : await this.content(config, prefix, file.path, base);
        const next = kind === "delete" ? null : await this.content(config, prefix, file.path, source);
        if (old === "large" || next === "large") { result.truncated = true; continue; }
        let patch = `diff --git a/${file.path} b/${file.path}\n`;
        if (old === "binary" || next === "binary") patch += `Binary files a/${file.path} and b/${file.path} differ\n`;
        else {
          if (old === null && next === null) continue;
          if (old && next && old.equals(next)) { hunked++; continue; }
          const hunks = await gitHunks(old, next); if (!hunks) continue;
          file.additions = hunks.additions; file.deletions = hunks.deletions;
          patch += old === null ? `new file mode 100644\n--- /dev/null\n+++ b/${file.path}\n` : next === null ? `deleted file mode 100644\n--- a/${file.path}\n+++ /dev/null\n` : `--- a/${file.path}\n+++ b/${file.path}\n`;
          patch += hunks.text;
        }
        hunked++; result.additions += file.additions; result.deletions += file.deletions;
        if (Buffer.byteLength(result.patch) + Buffer.byteLength(patch) > MAX_DIFF) { result.truncated = true; continue; }
        result.patch += patch;
      } catch { /* Keep unreadable files listed, as in the original desktop API. */ }
    }
    return result;
  }
}

async function gitHunks(old: Buffer | null, next: Buffer | null): Promise<{ additions: number; deletions: number; text: string } | null> {
  const directory = await mkdtemp(join(tmpdir(), "omnicode-azure-diff-"));
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  try {
    if (old) await writeFile(join(directory, "old"), old, { mode: 0o600 });
    if (next) await writeFile(join(directory, "new"), next, { mode: 0o600 });
    let output: string;
    try { output = (await localMachineIO.exec("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false", "-c", `core.attributesFile=${nullDevice}`, "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--unified=3", "--no-color", "--", old ? join(directory, "old") : nullDevice, next ? join(directory, "new") : nullDevice],
      { cwd: directory, windowsHide: true, timeout: 20_000, maxBuffer: MAX_DIFF * 2, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullDevice } })).stdout; }
    catch (error) { const value = error as { code?: number; stdout?: string }; if (value.code !== 1 || typeof value.stdout !== "string") return null; output = value.stdout; }
    const lines = output.split(/\r?\n/); const first = lines.findIndex(line => line.startsWith("@@")); if (first < 0) return { additions: 0, deletions: 0, text: "" };
    const hunks = lines.slice(first); if (!hunks.at(-1)) hunks.pop();
    return { additions: hunks.filter(line => line.startsWith("+") && !line.startsWith("+++")).length, deletions: hunks.filter(line => line.startsWith("-") && !line.startsWith("---")).length, text: hunks.join("\n") + "\n" };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
