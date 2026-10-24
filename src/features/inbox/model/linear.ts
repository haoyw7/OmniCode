import { inboxHostCommand as invoke } from "../../connections/model/inboxHost";
import { recordInboxSelfActivity } from "./inboxSelfActivity";

import type { LinearTeam, LinearIssue, LinearIssueDetails, LinearIssueThread, LinearStatus } from "../../../contracts/linear";

const TEAM_IDS_KEY = "omnicode.linearHiddenTeams";
export const LINEAR_CHANGE_EVENT = "omnicode:linear-change";

const detailsById = new Map<string, LinearIssueDetails>();
const threadById = new Map<string, LinearIssueThread>();
const threadInflight = new Map<string, Promise<LinearIssueThread>>();

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
  return detailsById.get(id) ?? null;
}

export async function linearIssueDetails(
  id: string,
): Promise<LinearIssueDetails> {
  const details = await invoke<LinearIssueDetails>("linear_issue_details", {
    id,
  });
  detailsById.set(id, details);
  return details;
}

export function peekLinearIssueThread(id: string): LinearIssueThread | null {
  return threadById.get(id) ?? null;
}

export async function linearIssueThread(
  id: string,
  options?: { force?: boolean },
): Promise<LinearIssueThread> {
  if (options?.force) {
    threadById.delete(id);
    threadInflight.delete(id);
  }
  const pending = threadInflight.get(id);
  if (pending) return pending;
  const promise = invoke<LinearIssueThread>("linear_issue_thread", { id })
    .then((thread) => {
      threadById.set(id, thread);
      return thread;
    })
    .finally(() => {
      if (threadInflight.get(id) === promise) threadInflight.delete(id);
    });
  threadInflight.set(id, promise);
  return promise;
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
  threadById.delete(id);
  threadInflight.delete(id);
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
