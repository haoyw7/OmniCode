import { inboxHostCommand } from "../../connections/model/inboxHost";
import { recordInboxSelfActivity } from "./inboxSelfActivity";
import { normalizeProjectPath } from "../../../domain/pathDisplay";

import type { AzureDevOpsKind, AzureDevOpsStatus, AzureDevOpsWorkItem, AzureDevOpsWorkItemDetails, AzureDevOpsWorkItemThread, AzureDevOpsMrDiff } from "../../../contracts/azureDevOps";

export const AZUREDEVOPS_CHANGE_EVENT = "omnicode:azuredevops-change";

const repoByPath = new Map<string, string>();
const detailsByKey = new Map<string, AzureDevOpsWorkItemDetails>();
const detailsInflight = new Map<string, Promise<AzureDevOpsWorkItemDetails>>();
const threadByKey = new Map<string, AzureDevOpsWorkItemThread>();
const threadInflight = new Map<string, Promise<AzureDevOpsWorkItemThread>>();
const diffByKey = new Map<string, AzureDevOpsMrDiff>();
const diffInflight = new Map<string, Promise<AzureDevOpsMrDiff>>();

function itemKey(repo: string, kind: AzureDevOpsKind, number: number): string {
  return `${repo.trim().toLowerCase()}:${kind}:${number}`;
}

export function clearAzureDevOpsCache() {
  repoByPath.clear();
  detailsByKey.clear();
  detailsInflight.clear();
  threadByKey.clear();
  threadInflight.clear();
  diffByKey.clear();
  diffInflight.clear();
}

export function azureDevOpsConnected(): Promise<AzureDevOpsStatus> {
  return inboxHostCommand<AzureDevOpsStatus>("azure_devops_status");
}

export async function saveAzureDevOpsConfig(
  url: string,
  token: string,
): Promise<AzureDevOpsStatus> {
  const status = await inboxHostCommand<AzureDevOpsStatus>("azure_devops_set_config", {
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
  const status = await inboxHostCommand<AzureDevOpsStatus>("azure_devops_set_config", {
    url: url.trim(),
    token: "",
  });
  clearAzureDevOpsCache();
  notifyAzureDevOpsChange();
  return status;
}

export async function azureDevOpsRepo(cwd: string): Promise<string> {
  const key = normalizeProjectPath(cwd);
  const cached = repoByPath.get(key);
  if (cached !== undefined) return cached;
  const repo = await inboxHostCommand<string>("azure_devops_repo", { cwd });
  repoByPath.set(key, repo);
  return repo;
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
  return inboxHostCommand<AzureDevOpsWorkItem[]>("azure_devops_list_work_items", {
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
  return inboxHostCommand<AzureDevOpsWorkItem[]>("azure_devops_list_todos", {
    kind: query.kind,
    limit: query.limit,
  });
}

export function peekAzureDevOpsWorkItemDetails(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): AzureDevOpsWorkItemDetails | null {
  return detailsByKey.get(itemKey(repo, kind, number)) ?? null;
}

export async function azureDevOpsWorkItemDetails(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): Promise<AzureDevOpsWorkItemDetails> {
  const key = itemKey(repo, kind, number);
  const cached = detailsInflight.get(key);
  if (cached) return cached;
  const pending = inboxHostCommand<AzureDevOpsWorkItemDetails>(
    "azure_devops_work_item_details",
    { repo, kind, number },
  )
    .then((details) => {
      // A cache clear (e.g. org change) supersedes this request: skip the
      // write so a stale completion cannot repopulate the cache.
      if (detailsInflight.get(key) === pending) detailsByKey.set(key, details);
      return details;
    })
    .finally(() => {
      if (detailsInflight.get(key) === pending) detailsInflight.delete(key);
    });
  detailsInflight.set(key, pending);
  return pending;
}

export function peekAzureDevOpsWorkItemThread(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
): AzureDevOpsWorkItemThread | null {
  return threadByKey.get(itemKey(repo, kind, number)) ?? null;
}

export async function azureDevOpsWorkItemThread(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
  options?: { force?: boolean },
): Promise<AzureDevOpsWorkItemThread> {
  const key = itemKey(repo, kind, number);
  if (options?.force) {
    threadByKey.delete(key);
    threadInflight.delete(key);
  }
  const cached = threadInflight.get(key);
  if (cached) return cached;
  const pending = inboxHostCommand<AzureDevOpsWorkItemThread>(
    "azure_devops_work_item_thread",
    {
      repo,
      kind,
      number,
    },
  )
    .then((thread) => {
      // A forced refresh or cache clear supersedes this request: skip the
      // write so a stale completion cannot repopulate the cache.
      if (threadInflight.get(key) === pending) threadByKey.set(key, thread);
      return thread;
    })
    .finally(() => {
      if (threadInflight.get(key) === pending) threadInflight.delete(key);
    });
  threadInflight.set(key, pending);
  return pending;
}

export async function azureDevOpsWorkItemComment(
  repo: string,
  kind: AzureDevOpsKind,
  number: number,
  body: string,
): Promise<string> {
  const url = await inboxHostCommand<string>("azure_devops_work_item_comment", {
    repo,
    kind,
    number,
    body: body.trim(),
  });
  const key = itemKey(repo, kind, number);
  threadByKey.delete(key);
  threadInflight.delete(key);
  recordInboxSelfActivity({ provider: "azuredevops", kind, repo, number });
  return url;
}

export function peekAzureDevOpsMrDiff(
  repo: string,
  number: number,
): AzureDevOpsMrDiff | null {
  return diffByKey.get(itemKey(repo, "pr", number)) ?? null;
}

export async function azureDevOpsMrDiff(
  repo: string,
  number: number,
): Promise<AzureDevOpsMrDiff> {
  const key = itemKey(repo, "pr", number);
  const cached = diffInflight.get(key);
  if (cached) return cached;
  const pending = inboxHostCommand<AzureDevOpsMrDiff>("azure_devops_mr_diff", {
    repo,
    number,
  })
    .then((diff) => {
      // Same staleness guard as the thread cache above.
      if (diffInflight.get(key) === pending) diffByKey.set(key, diff);
      return diff;
    })
    .finally(() => {
      if (diffInflight.get(key) === pending) diffInflight.delete(key);
    });
  diffInflight.set(key, pending);
  return pending;
}

export function notifyAzureDevOpsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AZUREDEVOPS_CHANGE_EVENT));
}
