import { queryClient } from "../../../shared/lib/queryClient";
import { fetchInboxSource, inboxSourceKey, invalidateInboxSource, peekInboxSource } from "./inboxSourceQueries";
import { invoke } from "@tauri-apps/api/core";
import { recordInboxSelfActivity } from "./inboxSelfActivity";

export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraIssue = {
  provider: "jira";
  kind: "jira";
  id: string;
  identifier: string;
  number: number;
  title: string;
  url: string;
  state: string;
  /** Jira status category: `new`, `indeterminate` or `done`. */
  stateType: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatarUrl?: string }[];
  draft: boolean;
  repo: string;
  teamId: string;
  teamName: string;
  projectPath: string;
};

export type JiraIssueDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
};

export type JiraIssueComment = {
  id: string;
  kind: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  path: string;
  line: number | null;
  resolved: boolean;
  threadId: string;
  replies: JiraIssueComment[];
};

export type JiraIssueThread = {
  comments: JiraIssueComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type JiraStatus = {
  connected: boolean;
  site: string;
  email: string;
};

const PROJECT_IDS_KEY = "omnicode.jiraHiddenProjects";
export const JIRA_CHANGE_EVENT = "omnicode:jira-change";

// Keyed by issue key (ENG-42): the REST paths and browse URLs both take it.


export function clearJiraCache() {
  queryClient.removeQueries({ queryKey: ["inboxSource", "jira"] });
}

export function jiraConnected(): Promise<JiraStatus> {
  return invoke<JiraStatus>("jira_status");
}

export async function saveJiraConfig(config: {
  site: string;
  email: string;
  token: string;
}): Promise<JiraStatus> {
  const status = await invoke<JiraStatus>("jira_set_config", {
    site: config.site.trim(),
    email: config.email.trim(),
    token: config.token.trim(),
  });
  clearJiraCache();
  return status;
}

export async function disconnectJira(): Promise<JiraStatus> {
  const status = await invoke<JiraStatus>("jira_set_config", {
    site: "",
    email: "",
    token: "",
  });
  clearJiraCache();
  return status;
}

export function listJiraProjects(): Promise<JiraProject[]> {
  return invoke<JiraProject[]>("jira_list_projects");
}

/** `null` means do not filter by project. `[]` means every known project is hidden. */
export function jiraProjectIdsForFetch(
  projects: readonly JiraProject[],
  hiddenIds: readonly string[],
): string[] | null {
  if (hiddenIds.length === 0) return null;
  const hidden = new Set(hiddenIds);
  const visible = projects
    .filter((project) => !hidden.has(project.id))
    .map((project) => project.id);
  if (visible.length === projects.length) return null;
  return visible;
}

export function listJiraIssues(query: {
  assignedToMe: boolean;
  state: "open" | "all";
  projectIds: string[];
  limit?: number;
}): Promise<JiraIssue[]> {
  return invoke<JiraIssue[]>("jira_list_issues", {
    assignedToMe: query.assignedToMe,
    state: query.state,
    projectIds: query.projectIds,
    limit: query.limit,
  });
}

export function peekJiraIssueDetails(key: string): JiraIssueDetails | null {
  return peekInboxSource<JiraIssueDetails>(inboxSourceKey("jira", "details", key));
}

export async function jiraIssueDetails(key: string): Promise<JiraIssueDetails> {
  return fetchInboxSource(inboxSourceKey("jira", "details", key), () => invoke<JiraIssueDetails>("jira_issue_details", { key }));

}

export function peekJiraIssueThread(key: string): JiraIssueThread | null {
  return peekInboxSource<JiraIssueThread>(inboxSourceKey("jira", "thread", key));
}

export async function jiraIssueThread(
  key: string,
  options?: { force?: boolean },
): Promise<JiraIssueThread> {
  return fetchInboxSource(inboxSourceKey("jira", "thread", key), () => invoke<JiraIssueThread>("jira_issue_thread", { key }), options);

}

export async function jiraIssueComment(
  issue: { id: string; key: string },
  body: string,
): Promise<string> {
  const url = await invoke<string>("jira_issue_comment", {
    key: issue.key,
    body: body.trim(),
  });
  await invalidateInboxSource(inboxSourceKey("jira", "thread", issue.key));
  recordInboxSelfActivity({ provider: "jira", kind: "jira", id: issue.id });
  return url;
}

export function loadHiddenJiraProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(PROJECT_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}

export function saveHiddenJiraProjectIds(ids: string[]) {
  try {
    localStorage.setItem(PROJECT_IDS_KEY, JSON.stringify(ids));
  } catch {
    // private mode / quota
  }
  notifyJiraChange();
}

export function notifyJiraChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(JIRA_CHANGE_EVENT));
}
