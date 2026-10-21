import { queryClient } from "../../../shared/lib/queryClient";
import { fetchInboxSource, inboxSourceKey, invalidateInboxSource, peekInboxSource } from "./inboxSourceQueries";
import { invoke } from "@tauri-apps/api/core";
import { recordInboxSelfActivity } from "./inboxSelfActivity";
import { normalizeProjectPath } from "../../projects/model/recents";

export type GitlabKind = "issue" | "pr";

export type GitlabStatus = {
  connected: boolean;
  url: string;
};

export type GitlabWorkItem = {
  kind: GitlabKind;
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatarUrl?: string }[];
  draft: boolean;
  repo: string;
  attentionReason: string;
};

export type GitlabWorkItemDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
  baseRefName?: string;
  headRefName?: string;
  reviewDecision?: string;
};

export type GitlabWorkItemComment = {
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
  replies: GitlabWorkItemComment[];
};

export type GitlabWorkItemThread = {
  comments: GitlabWorkItemComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type GitlabMrDiff = {
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  patch: string;
  truncated: boolean;
};

export const GITLAB_CHANGE_EVENT = "omnicode:gitlab-change";


function itemKey(repo: string, kind: GitlabKind, number: number): string {
  return `${repo.trim().toLowerCase()}:${kind}:${number}`;
}

export function clearGitlabCache() {
  queryClient.removeQueries({ queryKey: ["inboxSource", "gitlab"] });
}

export function gitlabConnected(): Promise<GitlabStatus> {
  return invoke<GitlabStatus>("gitlab_status");
}

export async function saveGitlabConfig(
  url: string,
  token: string,
): Promise<GitlabStatus> {
  const status = await invoke<GitlabStatus>("gitlab_set_config", {
    url: url.trim(),
    token: token.trim(),
  });
  clearGitlabCache();
  notifyGitlabChange();
  return status;
}

export async function disconnectGitlab(url: string): Promise<GitlabStatus> {
  const status = await invoke<GitlabStatus>("gitlab_set_config", {
    url: url.trim(),
    token: "",
  });
  clearGitlabCache();
  notifyGitlabChange();
  return status;
}

export async function gitlabRepo(cwd: string): Promise<string> {
  return fetchInboxSource(inboxSourceKey("gitlab", "repo", normalizeProjectPath(cwd)), () => invoke<string>("gitlab_repo", { cwd }), { maxAgeMs: Infinity });

}

export function listGitlabWorkItems(
  cwd: string,
  query: {
    kind: GitlabKind;
    assignedToMe: boolean;
    state: "open" | "all";
    limit?: number;
  },
): Promise<GitlabWorkItem[]> {
  return invoke<GitlabWorkItem[]>("gitlab_list_work_items", {
    cwd,
    kind: query.kind,
    assignedToMe: query.assignedToMe,
    state: query.state,
    limit: query.limit,
  });
}

export function listGitlabTodos(query: {
  kind: GitlabKind;
  limit?: number;
}): Promise<GitlabWorkItem[]> {
  return invoke<GitlabWorkItem[]>("gitlab_list_todos", {
    kind: query.kind,
    limit: query.limit,
  });
}

export function peekGitlabWorkItemDetails(
  repo: string,
  kind: GitlabKind,
  number: number,
): GitlabWorkItemDetails | null {
  return peekInboxSource<GitlabWorkItemDetails>(inboxSourceKey("gitlab", "details", itemKey(repo, kind, number)));
}

export async function gitlabWorkItemDetails(
  repo: string,
  kind: GitlabKind,
  number: number,
): Promise<GitlabWorkItemDetails> {
  return fetchInboxSource(inboxSourceKey("gitlab", "details", itemKey(repo, kind, number)), () => invoke<GitlabWorkItemDetails>("gitlab_work_item_details", { repo, kind, number }));

}

export function peekGitlabWorkItemThread(
  repo: string,
  kind: GitlabKind,
  number: number,
): GitlabWorkItemThread | null {
  return peekInboxSource<GitlabWorkItemThread>(inboxSourceKey("gitlab", "thread", itemKey(repo, kind, number)));
}

export async function gitlabWorkItemThread(
  repo: string,
  kind: GitlabKind,
  number: number,
  options?: { force?: boolean },
): Promise<GitlabWorkItemThread> {
  return fetchInboxSource(inboxSourceKey("gitlab", "thread", itemKey(repo, kind, number)), () => invoke<GitlabWorkItemThread>("gitlab_work_item_thread", { repo, kind, number }), options);

}

export async function gitlabWorkItemComment(
  repo: string,
  kind: GitlabKind,
  number: number,
  body: string,
): Promise<string> {
  const url = await invoke<string>("gitlab_work_item_comment", {
    repo,
    kind,
    number,
    body: body.trim(),
  });
  const key = itemKey(repo, kind, number);
  await invalidateInboxSource(inboxSourceKey("gitlab", "thread", key));
  recordInboxSelfActivity({ provider: "gitlab", kind, repo, number });
  return url;
}

export function peekGitlabMrDiff(
  repo: string,
  number: number,
): GitlabMrDiff | null {
  return peekInboxSource<GitlabMrDiff>(inboxSourceKey("gitlab", "diff", itemKey(repo, "pr", number)));
}

export async function gitlabMrDiff(
  repo: string,
  number: number,
): Promise<GitlabMrDiff> {
  return fetchInboxSource(inboxSourceKey("gitlab", "diff", itemKey(repo, "pr", number)), () => invoke<GitlabMrDiff>("gitlab_mr_diff", { repo, number }));

}

export function notifyGitlabChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GITLAB_CHANGE_EVENT));
}
