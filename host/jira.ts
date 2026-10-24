import { InboxCredentials } from "./inbox-credentials";
import { jiraRichText, textToAdf } from "./jira-adf";
import type { JiraIssue } from "../src/contracts/jira";

type Row = Record<string, unknown>;
type Config = { site: string; email: string; token: string };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const field = (value: unknown, key: string) => str(object(value)[key]);
const person = (value: unknown) => ({ name: field(value, "displayName"), avatar: field(object(value).avatarUrls, "48x48") });
const time = (value: unknown) => str(value).replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
const status = (config?: Config) => ({ connected: !!config, site: config?.site ?? "", email: config?.email ?? "" });
function issueKey(value: unknown): string {
  const key = str(value);
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(key)) throw new Error("Missing Jira issue");
  return key;
}
export function normalizeJiraSite(value: unknown): string {
  const input = str(value).replace(/\/+$/, "");
  if (!input) throw new Error("Enter your Jira site (e.g. yourteam.atlassian.net)");
  let url: URL;
  try { url = new URL(input.includes("://") ? input : input.includes(".") ? `https://${input}` : `https://${input}.atlassian.net`); }
  catch { throw new Error("Jira site is invalid"); }
  if (url.protocol !== "https:") throw new Error("Jira site must use HTTPS");
  if (url.username || url.password || !url.hostname) throw new Error("Jira site is invalid");
  return url.origin;
}
const commentUrl = (site: string, key: string, id: string) => `${site}/browse/${key}?focusedCommentId=${encodeURIComponent(id)}`;

export class HostJira {
  constructor(private credentials: InboxCredentials, private request: typeof fetch = fetch) {}
  private config(): Config | undefined {
    const stored = this.credentials.get("jira", "jira-config.json");
    if (!stored) return undefined;
    let value: Row;
    try { value = object(typeof stored === "string" ? JSON.parse(stored) : stored); } catch { throw new Error("Jira settings are invalid"); }
    if (!str(value.email) || !str(value.token)) return undefined;
    return { site: normalizeJiraSite(value.site), email: str(value.email), token: str(value.token) };
  }
  private async api(config: Config, path: string, body?: unknown): Promise<Row> {
    let response: Response;
    try { response = await this.request(config.site + path, { method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000), redirect: "error",
    }); } catch { throw new Error("Could not reach Jira"); }
    if (response.status === 401 || response.status === 403) throw new Error("Jira email or API token is invalid");
    if (!response.ok) throw new Error(`Jira request failed (${response.status})`);
    try { return object(await response.json()); } catch { throw new Error("Jira returned invalid JSON"); }
  }
  async run(command: string, params: Row = {}): Promise<unknown> {
    if (command === "jira_status") return status(this.config());
    if (command === "jira_set_config") {
      const token = str(params.token);
      if (!token) { this.credentials.set("jira", null); return status(); }
      const email = str(params.email);
      if (!email.includes("@")) throw new Error("Enter the email address of your Atlassian account");
      if (token.length > 8192 || email.length > 1000 || /[\r\n\0]/.test(token + email)) throw new Error("Jira settings are invalid");
      const config = { site: normalizeJiraSite(params.site), email, token };
      if (!field(await this.api(config, "/rest/api/3/myself"), "accountId")) throw new Error("Jira did not return the current user");
      this.credentials.set("jira", config); return status(config);
    }
    const config = this.config();
    if (!config && command === "jira_list_issues") return [];
    if (!config) throw new Error("Connect Jira in Settings");
    switch (command) {
      case "jira_list_projects": {
        const projects = new Map<string, { id: string; key: string; name: string }>();
        let start = 0;
        for (;;) {
          const data = await this.api(config, `/rest/api/3/project/search?maxResults=100&orderBy=name&startAt=${start}`);
          if (!Array.isArray(data.values)) throw new Error("Jira did not return projects");
          for (const value of data.values) { const id = field(value, "id"); if (id && !projects.has(id)) projects.set(id, { id, key: field(value, "key"), name: field(value, "name") || field(value, "key") }); }
          const next = (typeof data.startAt === "number" ? data.startAt : start) + data.values.length;
          if (data.isLast === true || (typeof data.total === "number" && next >= data.total)) break;
          if (!data.values.length || next <= start) { if (data.isLast === false) throw new Error("Jira project pagination did not advance"); break; }
          start = next;
        }
        return [...projects.values()];
      }
      case "jira_list_issues": {
        const clauses: string[] = [];
        if (params.assignedToMe === true) clauses.push("assignee = currentUser()");
        const ids = Array.isArray(params.projectIds) ? params.projectIds.map(str).filter(value => /^\d+$/.test(value)) : [];
        if (ids.length) clauses.push(`project in (${ids.join(", ")})`);
        if (str(params.state).toLowerCase() !== "all") clauses.push("statusCategory != Done");
        if (!clauses.length) clauses.push("updated >= -365d");
        const limit = typeof params.limit === "number" && Number.isFinite(params.limit) ? Math.max(1, Math.min(100, Math.floor(params.limit))) : 40;
        const data = await this.api(config, "/rest/api/3/search/jql", { jql: `${clauses.join(" AND ")} ORDER BY updated DESC`, maxResults: limit, fields: ["summary", "status", "updated", "labels", "assignee", "project"] });
        if (!Array.isArray(data.issues)) throw new Error("Jira did not return issues");
        return data.issues.filter(value => field(value, "id") && field(value, "key")).map(value => {
          const fields = object(object(value).fields); const assignee = person(fields.assignee); const key = field(value, "key");
          return { provider: "jira", kind: "jira", id: field(value, "id"), identifier: key, number: Number(key.split("-").at(-1)) || 0,
            url: `${config.site}/browse/${encodeURIComponent(key)}`, title: field(fields, "summary"), state: field(fields.status, "name") || "Open",
            stateType: field(object(fields.status).statusCategory, "key"), updatedAt: time(fields.updated),
            labels: Array.isArray(fields.labels) ? fields.labels.filter(value => typeof value === "string").map(name => ({ name, color: "" })) : [],
            assignees: assignee.name ? [{ login: assignee.name, avatarUrl: assignee.avatar }] : [], draft: false,
            repo: field(fields.project, "key"), teamId: field(fields.project, "id"), teamName: field(fields.project, "name"), projectPath: "" } satisfies JiraIssue;
        });
      }
      case "jira_issue_details": {
        const data = await this.api(config, `/rest/api/3/issue/${issueKey(params.key)}?fields=description,reporter,creator,assignee`);
        if (!data.fields) throw new Error("Jira did not return that issue");
        const fields = object(data.fields);
        const author = [fields.reporter, fields.creator, fields.assignee].map(person).find(value => value.name);
        return { body: jiraRichText(fields.description), author: author?.name ?? "", authorAvatarUrl: author?.avatar ?? "" };
      }
      case "jira_issue_thread": {
        const key = issueKey(params.key);
        const data = await this.api(config, `/rest/api/3/issue/${key}/comment?maxResults=50&orderBy=-created`);
        if (!Array.isArray(data.comments)) throw new Error("Jira did not return comments");
        const comments = data.comments.filter(value => field(value, "id")).map(value => {
          const id = field(value, "id"); const author = person(object(value).author);
          return { id, url: commentUrl(config.site, key, id), kind: "comment", author: author.name, authorAvatarUrl: author.avatar,
            body: jiraRichText(object(value).body), createdAt: time(object(value).created), state: "", path: "", line: null, resolved: false, threadId: "", replies: [] };
        }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { comments, truncated: typeof data.total === "number" && data.total > data.comments.length, reviewDecision: "", baseRefName: "", headRefName: "" };
      }
      case "jira_issue_comment": {
        const key = issueKey(params.key); const body = str(params.body);
        if (!body) throw new Error("Comment cannot be empty");
        const data = await this.api(config, `/rest/api/3/issue/${key}/comment`, { body: textToAdf(body) });
        const id = field(data, "id"); if (!id) throw new Error("Could not post Jira comment");
        return commentUrl(config.site, key, id);
      }
      default: throw new Error("Unsupported Jira operation");
    }
  }
}
