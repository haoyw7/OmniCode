import { homedir } from "node:os";
import { currentMachineIO, localMachineIO, machineExec } from "./machine-io";
import { GITHUB_ISSUE_THREAD_QUERY, GITHUB_PR_THREAD_QUERY, GITHUB_REVIEW_REPLY_MUTATION } from "./github-queries";
import type { GithubTaskKind, GithubWorkItem, GithubWorkItemComment, GithubWorkItemThread } from "../src/contracts/session";
import type { GithubPrCheckState } from "../src/contracts/github";

type Row = Record<string, unknown>;
export type GithubRunner = (args: string[], cwd: string, input?: string, maxBuffer?: number) => Promise<string>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const field = (value: unknown, key: string) => text(object(value)[key]);
const array = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const nodes = (value: unknown) => array(object(value).nodes);
const truncated = (value: unknown) => Number(object(value).totalCount ?? 0) > nodes(value).length;
const avatar = (login: string) => login.trim() ? `https://avatars.githubusercontent.com/${encodeURIComponent(login.trim())}?s=64` : "";
const json = (value: string): unknown => { try { return JSON.parse(value); } catch { throw new Error("GitHub returned invalid JSON"); } };
const kindOf = (value: unknown): GithubTaskKind => { if (value !== "issue" && value !== "pr") throw new Error("Unknown GitHub task kind"); return value; };
const itemNumber = (value: unknown): string => { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Invalid GitHub item number"); return String(value); };
function repoName(value: unknown): string {
  const repo = text(value).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split("/").some(part => part === "." || part === ".." || part.startsWith("-")))
    throw new Error("GitHub did not return a repository");
  return repo;
}
const fields = (kind: GithubTaskKind) => kind === "pr" ? "number,title,url,state,createdAt,updatedAt,labels,assignees,isDraft" : "number,title,url,state,stateReason,createdAt,updatedAt,labels,assignees";
const cap = 2 * 1024 * 1024;
function ghError(error: unknown): string {
  const cause = error as { code?: string; stderr?: string };
  if (cause.code === "ENOENT") return "GitHub CLI (`gh`) is not installed.";
  let message = text(cause.stderr).trim() || (error instanceof Error ? error.message : "GitHub request failed");
  for (const secret of [process.env.GH_TOKEN, process.env.GITHUB_TOKEN, process.env.GH_ENTERPRISE_TOKEN, process.env.GITHUB_ENTERPRISE_TOKEN])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[redacted]");
}
const defaultGh: GithubRunner = async (args, cwd, input, maxBuffer = 16 * 1024 * 1024) => (await localMachineIO.exec("gh", args, {
  cwd: currentMachineIO().key === "local" ? cwd : homedir(), input, timeout: 30_000, maxBuffer, windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GIT_PAGER: "cat" },
})).stdout.trim();
const defaultGit: GithubRunner = async (args, cwd, input, maxBuffer = 16 * 1024 * 1024) => (await machineExec("git", args, {
  cwd, input, timeout: 30_000, maxBuffer, windowsHide: true,
})).stdout;

export function githubCheckState(status: unknown, conclusion: unknown): GithubPrCheckState {
  const state = text(status).trim().toUpperCase();
  if (["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"].includes(state)) return "pending";
  if (state !== "" && state !== "COMPLETED") return "unknown";
  switch (text(conclusion).trim().toUpperCase()) {
    case "SUCCESS": return "pass";
    case "FAILURE": case "ERROR": case "TIMED_OUT": case "ACTION_REQUIRED": case "STARTUP_FAILURE": return "fail";
    case "QUEUED": case "IN_PROGRESS": case "PENDING": case "WAITING": case "REQUESTED": return "pending";
    case "NEUTRAL": case "SKIPPED": return "skipping";
    case "CANCELLED": return "cancel";
    default: return "unknown";
  }
}
function workItem(row: Row, kind: GithubTaskKind, repo: string): GithubWorkItem {
  if (!Number.isSafeInteger(row.number) || typeof row.title !== "string" || typeof row.url !== "string" || typeof row.state !== "string") throw new Error("GitHub did not return a work item");
  return { kind, repo, number: Number(row.number), title: row.title, url: row.url, state: row.state.toLowerCase(), stateReason: field(row, "stateReason").toLowerCase(),
    createdAt: field(row, "createdAt"), updatedAt: field(row, "updatedAt"), labels: array(row.labels).map(label => ({ name: field(label, "name"), color: field(label, "color") })),
    assignees: array(row.assignees).map(value => ({ login: field(value, "login"), avatarUrl: avatar(field(value, "login")) })), draft: row.isDraft === true };
}
function mappedComment(row: Row, kind = "comment", path = "", resolved = false): GithubWorkItemComment | undefined {
  if (row.isMinimized) return;
  const author = field(row.author, "login").trim(); const createdAt = field(row, "createdAt").trim();
  return { id: field(row, "id").trim() || `${kind}:${author}:${createdAt}`, kind, author, authorAvatarUrl: avatar(author), body: field(row, "body"), createdAt, url: field(row, "url"),
    state: "", path: field(row, "path").trim() || path, line: typeof row.line === "number" ? row.line : typeof row.originalLine === "number" ? row.originalLine : null,
    resolved, threadId: "", replies: [] };
}
export function githubThread(envelope: unknown, kind: GithubTaskKind): GithubWorkItemThread {
  const repo = object(object(envelope).data).repository;
  const value = object(repo)[kind === "pr" ? "pullRequest" : "issue"];
  if (!value) throw new Error("GitHub item not found");
  const row = object(value);
  const comments = nodes(row.comments).map(value => mappedComment(value)).filter((value): value is GithubWorkItemComment => !!value);
  let isTruncated = truncated(row.comments);
  const commits: GithubWorkItemThread["commits"] = [];
  if (kind === "pr") {
    isTruncated ||= truncated(row.commits) || truncated(row.reviews) || truncated(row.reviewThreads);
    for (const value of nodes(row.commits)) {
      const commit = object(value.commit); if (!field(commit, "oid").trim() || !field(commit, "committedDate").trim()) continue;
      commits.push({ oid: field(commit, "oid"), messageHeadline: field(commit, "messageHeadline"), committedDate: field(commit, "committedDate"), url: field(commit, "url"), author: field(object(commit.author).user, "login").trim() || field(commit.author, "name") });
    }
    for (const review of nodes(row.reviews)) {
      const state = field(review, "state").trim().toUpperCase(); const createdAt = field(review, "submittedAt").trim();
      if (!state || state === "PENDING" || !createdAt || state === "COMMENTED" && !field(review, "body").trim()) continue;
      comments.push({ ...mappedComment({ ...review, createdAt }, "review")!, state });
    }
    for (const thread of nodes(row.reviewThreads)) {
      isTruncated ||= truncated(thread.comments);
      const rows = nodes(thread.comments).map(comment => mappedComment(comment, "review_comment", field(thread, "path"), thread.isResolved === true))
        .filter((value): value is GithubWorkItemComment => !!value).map(value => ({ ...value, threadId: field(thread, "id").trim() }));
      if (rows.length) comments.push({ ...rows[0], replies: rows.slice(1) });
    }
  }
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { comments, commits, truncated: isTruncated, reviewDecision: field(row, "reviewDecision"), baseRefName: field(row, "baseRefName"), headRefName: field(row, "headRefName") };
}

/** Every request shares one Host rate-limit gate and the Host's gh credentials. */
export class HostGithub {
  private backoff?: { until: number; message: string };
  constructor(private execute: GithubRunner = defaultGh, private git: GithubRunner = defaultGit, private now: () => number = Date.now) {}
  private async gh(args: string[], cwd: string, input?: string, allowEmpty = false, maxBuffer?: number): Promise<string> {
    if (this.backoff && this.backoff.until > this.now()) throw new Error(this.backoff.message);
    this.backoff = undefined;
    try { const output = await this.execute(args, cwd, input, maxBuffer); if (!output.trim() && !allowEmpty) throw new Error("gh returned no output"); return output; }
    catch (error) {
      const message = ghError(error); const primary = /api rate limit.*exceeded/i.test(message); const secondary = /secondary rate limit|abuse detection/i.test(message);
      if ((primary || secondary) && !this.backoff) {
        this.backoff = { until: this.now() + 60_000, message };
        if (primary && /graphql/i.test(message)) {
          try {
            const reset = object(object(object(json(await this.execute(["api", "graphql", "--input", "-"], cwd, JSON.stringify({ query: "query { rateLimit { remaining resetAt } }" })))).data).rateLimit);
            if (typeof reset.remaining === "number") {
              if (reset.remaining > 0) this.backoff = undefined;
              else { const until = Date.parse(text(reset.resetAt)) + 1000; if (Number.isFinite(until)) this.backoff = until > this.now() ? { until, message } : undefined; }
            }
          } catch { /* Keep the one-minute fallback if the quota lookup fails. */ }
        }
      }
      throw new Error(message);
    }
  }
  private async gql(cwd: string, query: string, variables: Row): Promise<unknown> {
    return json(await this.gh(["api", "graphql", "--input", "-"], cwd, JSON.stringify({ query, variables })));
  }
  private async repository(cwd: string, parent = false): Promise<unknown> {
    let args = ["repo", "view", "--json", parent ? "nameWithOwner,parent" : "nameWithOwner"];
    if (currentMachineIO().key !== "local") {
      // Workspace Git runs on WSL; gh and its authenticated account stay on Host.
      const remotes = (await this.git(["remote", "-v"], cwd)).split(/\r?\n/);
      const remote = remotes.find(line => line.startsWith("origin\t")) ?? remotes[0];
      const match = /github\.com[:/]([^\s]+?)(?:\.git)?(?:\s|$)/i.exec(remote ?? "");
      if (!match) throw new Error("GitHub did not return a repository");
      args = ["repo", "view", repoName(match[1]), "--json", parent ? "nameWithOwner,parent" : "nameWithOwner"];
    }
    const view = object(json(await this.gh(args, cwd))); const name = repoName(view.nameWithOwner);
    if (!parent) return name;
    const parentName = object(view.parent).name ? repoName(`${field(object(view.parent).owner, "login")}/${field(view.parent, "name")}`) : "";
    return parentName && parentName.toLowerCase() !== name.toLowerCase() ? [name, parentName] : [name];
  }
  async run(command: string, params: Row = {}): Promise<unknown> {
    const cwd = text(params.cwd) || homedir();
    if (command === "git_github_status") {
      let installed = true; let authenticated = false;
      try { await this.execute(["auth", "status", "--active", "--hostname", "github.com"], homedir()); authenticated = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") installed = false;
        else if (/unknown flag: --active/.test(ghError(error))) try { await this.execute(["auth", "status", "--hostname", "github.com"], homedir()); authenticated = true; } catch { /* Installed but unauthenticated. */ }
      }
      return { installed, authenticated, connected: authenticated };
    }
    if (command === "git_github_repo") return this.repository(cwd);
    if (command === "git_github_repositories") return this.repository(cwd, true);
    const repo = repoName(params.repo);
    if (command === "git_github_check_details") return this.checkDetails(cwd, repo, params.jobId);
    const kind = command.startsWith("git_github_pr_") ? "pr" : kindOf(params.kind);
    if (command === "git_github_work_items") {
      const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(100, Math.floor(Number(params.limit)))) : 40;
      const args = [kind, "list", "--state", text(params.state).trim().toLowerCase() === "all" ? "all" : "open", "--limit", String(limit), "--repo", repo, "--json", fields(kind)];
      if (params.assignedToMe === true) args.push("--assignee", "@me");
      if (text(params.search).trim()) args.push("--search", text(params.search).trim());
      const rows = json(await this.gh(args, cwd)); if (!Array.isArray(rows)) throw new Error("GitHub did not return work items");
      return rows.map(row => workItem(object(row), kind, repo));
    }
    const number = itemNumber(params.number);
    const view = async (selection: string) => object(json(await this.gh([kind, "view", number, "--repo", repo, "--json", selection], cwd)));
    switch (command) {
      case "git_github_work_item": return workItem(await view(fields(kind)), kind, repo);
      case "git_github_work_item_details": {
        const row = await view(kind === "pr" ? "body,author,baseRefName,headRefName,reviewDecision" : "body,author"); const author = field(row.author, "login");
        return { body: field(row, "body"), author, authorAvatarUrl: avatar(author), baseRefName: field(row, "baseRefName"), headRefName: field(row, "headRefName"), reviewDecision: field(row, "reviewDecision") };
      }
      case "git_github_work_item_thread": {
        const [owner, name] = repo.split("/");
        return githubThread(await this.gql(cwd, kind === "pr" ? GITHUB_PR_THREAD_QUERY : GITHUB_ISSUE_THREAD_QUERY, { owner, name, number: Number(number) }), kind);
      }
      case "git_github_work_item_comment": {
        const body = text(params.body).trim(); if (!body) throw new Error("Comment cannot be empty");
        const reply = text(params.inReplyTo).trim();
        if (reply) {
          if (!/^[A-Za-z0-9_=-]{1,255}$/.test(reply)) throw new Error("Invalid review thread");
          const result = object(await this.gql(cwd, GITHUB_REVIEW_REPLY_MUTATION, { threadId: reply, body }));
          const url = field(object(object(result.data).addPullRequestReviewThreadReply).comment, "url");
          if (!/^https?:\/\//.test(url)) throw new Error("GitHub did not return a comment URL"); return url;
        }
        const output = await this.gh([kind, "comment", number, "--repo", repo, "--body-file", "-"], cwd, body);
        const url = output.split(/\r?\n/).reverse().find(line => /^https?:\/\//.test(line.trim()));
        if (!url) throw new Error("GitHub did not return a comment URL"); return url.trim();
      }
      case "git_github_pr_action": {
        const action = text(params.action).trim();
        let args: string[];
        if (["merge", "squash", "rebase"].includes(action)) args = ["pr", "merge", number, "--repo", repo, `--${action}`];
        else if (action === "draft") args = ["pr", "ready", number, "--repo", repo, "--undo"];
        else if (["ready", "close", "reopen"].includes(action)) args = ["pr", action, number, "--repo", repo];
        else throw new Error("Unknown GitHub pull request action");
        await this.gh(args, cwd, undefined, true); return workItem(await view(fields("pr")), "pr", repo);
      }
      case "git_github_pr_checks": return this.checks(await view("headRefOid,statusCheckRollup"));
      case "git_github_pr_diff": {
        const full = params.fullContext === true;
        const row = await view(full ? "files,additions,deletions,baseRefOid,headRefOid" : "files,additions,deletions");
        let patch = ""; let limited = false;
        try { patch = full ? await this.fullDiff(cwd, repo, field(row, "baseRefOid"), field(row, "headRefOid")) : await this.gh(["pr", "diff", number, "--repo", repo], cwd, undefined, true, cap); }
        catch (error) { if (/maxBuffer|max buffer/i.test(String(error))) limited = true; else throw error; }
        if (Buffer.byteLength(patch) > cap) { limited = true; patch = ""; }
        const files = array(row.files).map(value => ({ path: field(value, "path"), additions: Number(value.additions) || 0, deletions: Number(value.deletions) || 0 }));
        let additions = Number(row.additions) || 0; let deletions = Number(row.deletions) || 0;
        if (!additions && !deletions) { additions = files.reduce((total, value) => total + value.additions, 0); deletions = files.reduce((total, value) => total + value.deletions, 0); }
        return { files, additions, deletions, patch, truncated: limited };
      }
      default: throw new Error("Unsupported GitHub operation");
    }
  }

  private checks(row: Row) {
    const headOid = field(row, "headRefOid").trim(); if (!headOid) throw new Error("Pull request is missing head commit");
    if (row.statusCheckRollup != null && !Array.isArray(row.statusCheckRollup)) throw new Error("GitHub returned invalid checks");
    return { headOid, checks: array(row.statusCheckRollup).map(check => {
      const statusContext = field(check, "__typename") ? field(check, "__typename").toLowerCase() === "statuscontext" : !!field(check, "context");
      return statusContext ? { name: field(check, "context"), workflow: "", state: githubCheckState("", check.state), url: text(check.targetUrl).trim() || null, startedAt: check.createdAt ?? null, completedAt: null }
        : { name: field(check, "name"), workflow: field(check, "workflowName"), state: githubCheckState(check.status, check.conclusion), url: text(check.detailsUrl).trim() || null, startedAt: check.startedAt ?? null, completedAt: check.completedAt ?? null };
    }) };
  }
  private async checkDetails(cwd: string, repo: string, job: unknown) {
    const id = text(job); if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid GitHub repository or job ID");
    const prefix = `repos/${repo}`;
    const data = object(json(await this.gh(["api", "--hostname", "github.com", `${prefix}/actions/jobs/${id}`], cwd)));
    if (String(data.id) !== id) throw new Error("GitHub returned a different job");
    const steps = array(data.steps).map(step => ({ name: field(step, "name"), state: githubCheckState(step.status, step.conclusion), startedAt: step.started_at ?? null, completedAt: step.completed_at ?? null }));
    let annotations: { path: string; line: number; message: string; level: string }[] = []; let notice: string | null = null;
    const checkPrefix = `https://api.github.com/${prefix}/check-runs/`; const url = field(data, "check_run_url"); const checkId = url.startsWith(checkPrefix) ? url.slice(checkPrefix.length) : "";
    if (/^\d+$/.test(checkId)) {
      try {
        const result = json(await this.gh(["api", "--hostname", "github.com", `${prefix}/check-runs/${checkId}/annotations?per_page=100`], cwd));
        if (!Array.isArray(result)) throw new Error("Invalid check annotations");
        annotations = result.map(value => ({ path: field(value, "path"), line: Number(object(value).start_line) || 0, message: field(value, "message"), level: field(value, "annotation_level") }));
        if (annotations.length === 100) notice = "Showing the first 100 annotations. View the full log on GitHub for more.";
      } catch { notice = "Could not load error annotations. View the full log on GitHub."; }
    } else notice = "Error annotations are unavailable. View the full log on GitHub.";
    return { steps, annotations, notice };
  }
  private async fullDiff(cwd: string, repo: string, base: string, head: string): Promise<string> {
    if (![base, head].every(value => /^[a-f0-9]{40,64}$/i.test(value))) throw new Error("Pull request is missing base or head commit");
    const remotes = (await this.git(["remote", "-v"], cwd)).split(/\r?\n/).map(line => line.split(/\s+/));
    const normalized = (url: string) => url.toLowerCase().replace(/^.*github\.com[:/]/, "").replace(/\/$/, "").replace(/\.git$/, "");
    const remote = remotes.find(value => normalized(value[1] ?? "") === repo.toLowerCase())?.[0];
    const exists = async (args: string[]) => { try { await this.git(args, cwd); return true; } catch { return false; } };
    for (const oid of [base, head]) {
      if (await exists(["cat-file", "-e", `${oid}^{commit}`])) continue;
      if (remote) await exists(["fetch", "--no-tags", "--depth", "1", remote, oid]);
      if (!await exists(["cat-file", "-e", `${oid}^{commit}`])) throw new Error(`Missing git commit ${oid}. Fetch the pull request refs and try again.`);
    }
    let mergeBase = await exists(["merge-base", base, head]);
    if (!mergeBase && remote) for (const deepen of ["50", "200", "800"]) {
      await exists(["fetch", "--no-tags", "--deepen", deepen, remote]);
      if (await exists(["merge-base", base, head])) { mergeBase = true; break; }
    }
    if (!mergeBase) throw new Error(`Cannot find a merge base for ${base} and ${head}. Fetch more history and try again.`);
    return this.git(["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U999999", `${base}...${head}`], cwd, undefined, cap);
  }
}
