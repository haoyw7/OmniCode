import { InboxCredentials } from "./inbox-credentials";
import type { LinearIssue, LinearIssueComment } from "../src/contracts/linear";

const VIEWER = "query { viewer { id } }";
const TEAMS = "query { teams(first: 50) { nodes { id key name } } }";
const ISSUES = `query InboxIssues($first: Int!, $filter: IssueFilter) { issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes {
 id identifier number title url updatedAt state { name type } team { id key name } project { id name }
 labels { nodes { name color } } assignee { name displayName avatarUrl } } } }`;
const DETAILS = `query InboxIssue($id: String!) { issue(id: $id) { description creator { name displayName avatarUrl } assignee { name displayName avatarUrl } } }`;
const COMMENTS = `query InboxIssueComments($id: String!) { issue(id: $id) { comments(first: 50) { pageInfo { hasNextPage } nodes {
 id body createdAt url user { name displayName avatarUrl } parent { id } } } } }`;
const CREATE = `mutation InboxCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`;
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const field = (value: unknown, name: string) => str(object(value)[name]);
const person = (value: unknown) => ({ name: field(value, "displayName") || field(value, "name"), avatar: field(value, "avatarUrl") });
const nodes = (value: unknown, label: string): Row[] => {
  const result = object(value).nodes;
  if (!Array.isArray(result)) throw new Error(`Linear did not return ${label}`);
  return result.map(object);
};
const issueId = (input: unknown) => {
  const id = str(input);
  if (!/^[A-Za-z0-9_-]{1,127}$/.test(id)) throw new Error("Missing Linear issue");
  return id;
};

export class HostLinear {
  constructor(private credentials: InboxCredentials, private request: typeof fetch = fetch) {}
  private token() { return str(this.credentials.get("linear", "linear-token")); }
  private async graphql(token: string, query: string, variables: Row = {}): Promise<Row> {
    if (!token) throw new Error("Connect Linear in Settings");
    const authorization = token.replace(/^(?:Bearer|bearer)\s+/, "").trim();
    let response: Response;
    try { response = await this.request("https://api.linear.app/graphql", {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000), redirect: "error",
    }); } catch { throw new Error("Could not reach Linear"); }
    if (response.status === 401 || response.status === 403) throw new Error("Linear API key is invalid");
    if (!response.ok) throw new Error(`Linear request failed (${response.status})`);
    let payload: Row;
    try { payload = object(await response.json()); } catch { throw new Error("Linear returned invalid JSON"); }
    const error = Array.isArray(payload.errors) ? field(payload.errors[0], "message") : "";
    if (error) {
      if (/auth|unauthor/i.test(error)) throw new Error("Linear API key is invalid");
      // Remote errors can echo request headers/variables. No secret/body crosses back.
      throw new Error("Linear rejected the request");
    }
    if (!payload.data || typeof payload.data !== "object") throw new Error("Linear returned no data");
    return object(payload.data);
  }

  async run(command: string, params: Row = {}): Promise<unknown> {
    if (command === "linear_status") return { connected: !!this.token() };
    if (command === "linear_set_token") {
      const token = str(params.token);
      if (token.length > 8192 || /[\r\n\0]/.test(token)) throw new Error("Invalid Linear API key");
      if (token) await this.graphql(token, VIEWER);
      this.credentials.set("linear", token || null);
      return { connected: !!token };
    }
    const token = this.token();
    if (command === "linear_list_issues" && !token) return [];
    if (!token) throw new Error("Connect Linear in Settings");
    switch (command) {
      case "linear_list_teams": {
        const data = await this.graphql(token, TEAMS);
        return nodes(data.teams, "teams").filter(value => field(value, "id")).map(value => ({
          id: field(value, "id"), key: field(value, "key"), name: field(value, "name") || field(value, "key"),
        }));
      }
      case "linear_list_issues": {
        const filter: Row = {};
        if (params.assignedToMe === true) filter.assignee = { isMe: { eq: true } };
        const teams = Array.isArray(params.teamIds) ? params.teamIds.map(str).filter(Boolean) : [];
        if (teams.length) filter.team = { id: { in: teams } };
        if (str(params.state).toLowerCase() !== "all") filter.state = { type: { nin: ["completed", "canceled"] } };
        const first = typeof params.limit === "number" && Number.isFinite(params.limit) ? Math.max(1, Math.min(100, Math.floor(params.limit))) : 40;
        const data = await this.graphql(token, ISSUES, { first, filter });
        return nodes(data.issues, "issues").filter(value => field(value, "id")).map(value => {
          const assignee = person(value.assignee);
          const labels = object(value.labels).nodes;
          return { provider: "linear", kind: "linear", id: field(value, "id"), identifier: field(value, "identifier"),
            number: typeof value.number === "number" ? value.number : 0, title: field(value, "title"), url: field(value, "url"),
            state: field(value.state, "name") || "Open", stateType: field(value.state, "type"), updatedAt: field(value, "updatedAt"),
            labels: Array.isArray(labels) ? labels.filter(label => typeof object(label).name === "string").map(label => ({ name: field(label, "name"), color: field(label, "color").replace(/^#+/, "") })) : [],
            assignees: assignee.name ? [{ login: assignee.name, avatarUrl: assignee.avatar }] : [], draft: false,
            repo: field(value.team, "key"), teamId: field(value.team, "id"), teamName: field(value.team, "name") || field(value.team, "key"),
            projectId: field(value.project, "id"), projectName: field(value.project, "name"), projectPath: "" } satisfies LinearIssue;
        });
      }
      case "linear_issue_details": {
        const data = await this.graphql(token, DETAILS, { id: issueId(params.id) });
        if (!data.issue) throw new Error("Linear did not return that issue");
        const issue = object(data.issue); const creator = person(issue.creator); const author = creator.name ? creator : person(issue.assignee);
        return { body: field(issue, "description"), author: author.name, authorAvatarUrl: author.avatar };
      }
      case "linear_issue_thread": {
        const data = await this.graphql(token, COMMENTS, { id: issueId(params.id) });
        const comments = object(object(data.issue).comments);
        const rows = nodes(comments, "comments").filter(value => field(value, "id")).sort((a, b) => field(a, "createdAt").localeCompare(field(b, "createdAt")));
        const parents = new Map(rows.map(value => [field(value, "id"), field(value.parent, "id")]));
        type Comment = LinearIssueComment;
        const groups = new Map<string, Comment[]>(); const top: Comment[] = [];
        for (const value of rows) {
          const id = field(value, "id"); let root = id; const seen = new Set<string>();
          while (parents.has(parents.get(root) ?? "")) {
            if (seen.has(root)) { root = id; break; }
            seen.add(root); root = parents.get(root)!;
          }
          const author = person(value.user);
          const comment: Comment = { id, kind: "comment", author: author.name, authorAvatarUrl: author.avatar, body: field(value, "body"),
            createdAt: field(value, "createdAt"), url: field(value, "url"), state: "", path: "", line: null, resolved: false, threadId: "", replies: [] };
          if (root === id) top.push(comment); else { const replies = groups.get(root) ?? []; replies.push(comment); groups.set(root, replies); }
        }
        for (const comment of top) comment.replies = groups.get(comment.id) ?? [];
        return { comments: top, truncated: object(comments.pageInfo).hasNextPage === true, reviewDecision: "", baseRefName: "", headRefName: "" };
      }
      case "linear_issue_comment": {
        const id = issueId(params.id); const body = str(params.body); const parent = str(params.parentId);
        if (!body) throw new Error("Comment cannot be empty");
        if (parent) issueId(parent);
        const data = await this.graphql(token, CREATE, { input: { issueId: id, body, ...(parent ? { parentId: parent } : {}) } });
        if (object(data.commentCreate).success !== true) throw new Error("Could not post Linear comment");
        return field(object(data.commentCreate).comment, "url");
      }
      default: throw new Error("Unsupported Linear operation");
    }
  }
}
