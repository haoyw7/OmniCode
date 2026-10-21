import { fetchInboxSource, inboxSourceKey, invalidateInboxSource, peekInboxSource } from "./inboxSourceQueries";
import { invoke } from "@tauri-apps/api/core";
import { recordInboxSelfActivity } from "./inboxSelfActivity";

export type LinearTeam = {
  id: string;
  key: string;
  name: string;
};

export type LinearIssue = {
  provider: "linear";
  kind: "linear";
  id: string;
  identifier: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateType: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatarUrl?: string }[];
  draft: boolean;
  repo: string;
  teamId: string;
  teamName: string;
  projectId: string;
  projectName: string;
  projectPath: string;
};

export type LinearIssueDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
};

export type LinearIssueComment = {
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
  replies: LinearIssueComment[];
};

export type LinearIssueThread = {
  comments: LinearIssueComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type LinearStatus = {
  connected: boolean;
};

const TEAM_IDS_KEY = "omnicode.linearHiddenTeams";
export const LINEAR_CHANGE_EVENT = "omnicode:linear-change";


export function linearConnected(): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_status");
}

export function saveLinearToken(token: string): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_set_token", { token: token.trim() });
}

export function disconnectLinear(): Promise<LinearStatus> {
  return invoke<LinearStatus>("linear_set_token", { token: "" });
}

export function listLinearTeams(): Promise<LinearTeam[]> {
  return invoke<LinearTeam[]>("linear_list_teams");
}

/** `null` means do not filter by team. `[]` means every known team is hidden. */
export function linearTeamIdsForFetch(
  teams: readonly LinearTeam[],
  hiddenIds: readonly string[],
): string[] | null {
  if (hiddenIds.length === 0) return null;
  const hidden = new Set(hiddenIds);
  const visible = teams
    .filter((team) => !hidden.has(team.id))
    .map((team) => team.id);
  if (visible.length === teams.length) return null;
  return visible;
}

export function listLinearIssues(query: {
  assignedToMe: boolean;
  state: "open" | "all";
  teamIds: string[];
  limit?: number;
}): Promise<LinearIssue[]> {
  return invoke<LinearIssue[]>("linear_list_issues", {
    assignedToMe: query.assignedToMe,
    state: query.state,
    teamIds: query.teamIds,
    limit: query.limit,
  });
}

export function peekLinearIssueDetails(id: string): LinearIssueDetails | null {
  return peekInboxSource<LinearIssueDetails>(inboxSourceKey("linear", "details", id));
}

export async function linearIssueDetails(
  id: string,
): Promise<LinearIssueDetails> {
  return fetchInboxSource(inboxSourceKey("linear", "details", id), () => invoke<LinearIssueDetails>("linear_issue_details", { id }));

}

export function peekLinearIssueThread(id: string): LinearIssueThread | null {
  return peekInboxSource<LinearIssueThread>(inboxSourceKey("linear", "thread", id));
}

export async function linearIssueThread(
  id: string,
  options?: { force?: boolean },
): Promise<LinearIssueThread> {
  return fetchInboxSource(inboxSourceKey("linear", "thread", id), () => invoke<LinearIssueThread>("linear_issue_thread", { id }), options);

}

export async function linearIssueComment(
  id: string,
  body: string,
  options?: { parentId?: string },
): Promise<string> {
  const url = await invoke<string>("linear_issue_comment", {
    id,
    body: body.trim(),
    parentId: options?.parentId?.trim() ?? "",
  });
  await invalidateInboxSource(inboxSourceKey("linear", "thread", id));
  recordInboxSelfActivity({ provider: "linear", kind: "linear", id });
  return url;
}

export function loadHiddenLinearTeamIds(): string[] {
  try {
    const raw = localStorage.getItem(TEAM_IDS_KEY);
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

export function saveHiddenLinearTeamIds(ids: string[]) {
  try {
    localStorage.setItem(TEAM_IDS_KEY, JSON.stringify(ids));
  } catch {
    // private mode / quota
  }
  notifyLinearChange();
}

export function notifyLinearChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LINEAR_CHANGE_EVENT));
}
