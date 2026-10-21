import { queryClient } from "../../../shared/lib/queryClient";
import { fetchInboxSource, inboxSourceKey, invalidateInboxSource, peekInboxSource } from "./inboxSourceQueries";
import { invoke } from "@tauri-apps/api/core";
import { recordInboxSelfActivity } from "./inboxSelfActivity";
import { normalizeProjectPath } from "../../projects/model/recents";

export type AzureDevOpsKind = "issue" | "pr";

export type AzureDevOpsStatus = {
  connected: boolean;
  url: string;
  organization: string;
};

export type AzureDevOpsWorkItem = {
  kind: AzureDevOpsKind;
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

export type AzureDevOpsWorkItemDetails = {
  body: string;
  author: string;
  authorAvatarUrl?: string;
  baseRefName?: string;
  headRefName?: string;
  reviewDecision?: string;
};

export type AzureDevOpsWorkItemComment = {
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
  replies: AzureDevOpsWorkItemComment[];
};

export type AzureDevOpsWorkItemThread = {
  comments: AzureDevOpsWorkItemComment[];
  truncated: boolean;
  reviewDecision: string;
  baseRefName: string;
  headRefName: string;
};

export type AzureDevOpsMrDiff = {
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  patch: string;
  truncated: boolean;
};

export const AZUREDEVOPS_CHANGE_EVENT = "omnicode:azuredevops-change";


function itemKey(repo: string, kind: AzureDevOpsKind, number: number): string {
  return `${repo.trim().toLowerCase()}:${kind}:${number}`;
}

export function clearAzureDevOpsCache() {
  queryClient.removeQueries({ queryKey: ["inboxSource", "azuredevops"] });
}

export function azureDevOpsConnected(): Promise<AzureDevOpsStatus> {
  return invoke<AzureDevOpsStatus>("azure_devops_status");
}

export async function saveAzureDevOpsConfig(
  url: string,
  token: string,
): Promise<AzureDevOpsStatus> {
  const status = await invoke<AzureDevOpsStatus>("azure_devops_set_config", {
    url: url.trim(),
    token: token.trim(),
  });
  clearAzureDevOpsCache();
  notifyAzureDevOpsChange();
  return status;
}

export async function disconnectAzureDevOps(
  url: string,
): Promise<AzureDevOpsStatus> {
  const status = await invoke<AzureDevOpsStatus>("azure_devops_set_config", {
    url: url.trim(),
    token: "",
  });
  clearAzureDevOpsCache();
  notifyAzureDevOpsChange();
  return status;
}

export async function azureDevOpsRepo(cwd: string): Promise<string> {
  return fetchInboxSource(inboxSourceKey("azuredevops", "repo", normalizeProjectPath(cwd)), () => invoke<string>("azure_devops_repo", { cwd }), { maxAgeMs: Infinity });

}

export function listAzureDevOpsWorkItems(
  cwd: string,
  query: {
    kind: AzureDevOpsKind;
    assignedToMe: boolean;
    state: "open" | "all";
    limit?: number;
  },
): Promise<AzureDevOpsWorkItem[]> {
  return invoke<AzureDevOpsWorkItem[]>("azure_devops_list_work_items", {
    cwd,
    kind: query.kind,
    assignedToMe: query.assignedToMe,
    state: query.state,
    limit: query.limit,
  });
}

export function listAzureDevOpsTodos(query: {
  kind: AzureDevOpsKind;
  limit?: number;
}): Promise<AzureDevOpsWorkItem[]> {
  return invoke<AzureDevOpsWorkItem[]>("azure_devops_list_todos", {
    kind: query.kind,
    limit: query.limit,
  });
}

export function peekAzureDevOpsWorkItemDetails(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): AzureDevOpsWorkItemDetails | null {
  return peekInboxSource<AzureDevOpsWorkItemDetails>(inboxSourceKey("azuredevops", "details", itemKey(repo, kind, number)));
}

export async function azureDevOpsWorkItemDetails(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): Promise<AzureDevOpsWorkItemDetails> {
  return fetchInboxSource(inboxSourceKey("azuredevops", "details", itemKey(repo, kind, number)), () => invoke<AzureDevOpsWorkItemDetails>("azure_devops_work_item_details", { repo, kind, number }));

}

export function peekAzureDevOpsWorkItemThread(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): AzureDevOpsWorkItemThread | null {
  return peekInboxSource<AzureDevOpsWorkItemThread>(inboxSourceKey("azuredevops", "thread", itemKey(repo, kind, number)));
}

export async function azureDevOpsWorkItemThread(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
  options?: { force?: boolean },
): Promise<AzureDevOpsWorkItemThread> {
  return fetchInboxSource(inboxSourceKey("azuredevops", "thread", itemKey(repo, kind, number)), () => invoke<AzureDevOpsWorkItemThread>("azure_devops_work_item_thread", { repo, kind, number }), options);

}

export async function azureDevOpsWorkItemComment(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
  body: string,
): Promise<string> {
  const url = await invoke<string>("azure_devops_work_item_comment", {
    repo,
    kind,
    number,
    body: body.trim(),
  });
  const key = itemKey(repo, kind, number);
  await invalidateInboxSource(inboxSourceKey("azuredevops", "thread", key));
  recordInboxSelfActivity({ provider: "azuredevops", kind, repo, number });
  return url;
}

export function peekAzureDevOpsMrDiff(
  repo: string,
  number: number,
): AzureDevOpsMrDiff | null {
  return peekInboxSource<AzureDevOpsMrDiff>(inboxSourceKey("azuredevops", "diff", itemKey(repo, "pr", number)));
}

export async function azureDevOpsMrDiff(
  repo: string,
  number: number,
): Promise<AzureDevOpsMrDiff> {
  return fetchInboxSource(inboxSourceKey("azuredevops", "diff", itemKey(repo, "pr", number)), () => invoke<AzureDevOpsMrDiff>("azure_devops_mr_diff", { repo, number }));

}

export function notifyAzureDevOpsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AZUREDEVOPS_CHANGE_EVENT));
}
