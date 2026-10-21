import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import {
  githubStatus, githubWorkItem, githubWorkItemDetails, githubWorkItemThread,
  githubPrDiff, githubWorkItemComment, inboxItemKey, inboxListCacheKey,
  inboxListIsFresh, listInboxItems, peekInboxList, peekGithubWorkItem,
  peekGithubWorkItemDetails, peekGithubWorkItemThread, peekGithubPrDiff,
  GITHUB_WORK_ITEM_FRESH_MS,
  type InboxItem, type InboxQuery, type InboxListResult, type GithubWorkItemDetails,
} from "./githubTasks";
import { loadInboxConnections } from "./inboxFilters";
import { linearConnected, listLinearTeams, linearIssueDetails, linearIssueThread, linearIssueComment, peekLinearIssueDetails, peekLinearIssueThread } from "./linear";
import { jiraConnected, listJiraProjects, jiraIssueDetails, jiraIssueThread, jiraIssueComment, peekJiraIssueDetails, peekJiraIssueThread } from "./jira";
import { gitlabConnected, gitlabWorkItemDetails, gitlabWorkItemThread, gitlabMrDiff, gitlabWorkItemComment, peekGitlabWorkItemDetails, peekGitlabWorkItemThread, peekGitlabMrDiff } from "./gitlab";
import { azureDevOpsConnected, azureDevOpsWorkItemDetails, azureDevOpsWorkItemThread, azureDevOpsMrDiff, azureDevOpsWorkItemComment, peekAzureDevOpsWorkItemDetails, peekAzureDevOpsWorkItemThread, peekAzureDevOpsMrDiff } from "./azureDevOps";
import type { LinkedWorkItem } from "../../sessions/model/session";

export const inboxKeys = {
  all: ["inbox"] as const,
  connections: ["inbox", "connections"] as const,
  lists: ["inbox", "list"] as const,
  list: (projects: readonly { path: string }[], query: InboxQuery) => ["inbox", "list", inboxListCacheKey(projects, query)] as const,
  item: (cwd: string, target: LinkedWorkItem | null) => ["inbox", "item", cwd, target?.repo, target?.kind, target?.number] as const,
  detail: (item: InboxItem) => ["inbox", "detail", item.projectPath, inboxItemKey(item)] as const,
  teams: ["inbox", "linearTeams"] as const,
  projects: ["inbox", "jiraProjects"] as const,
};

export const inboxConnectionsQuery = () => queryOptions({
  queryKey: inboxKeys.connections,
  initialData: loadInboxConnections,
  initialDataUpdatedAt: 0,
  queryFn: async () => {
    const previous = queryClient.getQueryData<ReturnType<typeof loadInboxConnections>>(inboxKeys.connections) ?? loadInboxConnections();
    const [github, linear, jira, gitlab, azuredevops] = await Promise.allSettled([
      githubStatus(), linearConnected(), jiraConnected(), gitlabConnected(), azureDevOpsConnected(),
    ]);
    return {
      github: github.status === "fulfilled" ? github.value.connected : previous.github,
      linear: linear.status === "fulfilled" ? linear.value.connected : previous.linear,
      jira: jira.status === "fulfilled" ? jira.value.connected : previous.jira,
      gitlab: gitlab.status === "fulfilled" ? gitlab.value.connected : previous.gitlab,
      azuredevops: azuredevops.status === "fulfilled" ? azuredevops.value.connected : previous.azuredevops,
    };
  },
});

export const inboxListQuery = (projects: { path: string }[], query: InboxQuery) => queryOptions({
  queryKey: inboxKeys.list(projects, query),
  queryFn: () => listInboxItems(projects, query, { force: true }),
  initialData: () => peekInboxList(projects, query) ?? undefined,
  initialDataUpdatedAt: () => inboxListIsFresh(projects, query) ? Date.now() : 0,
  staleTime: 30_000,
});

export const linkedWorkItemQuery = (cwd: string, target: LinkedWorkItem | null) => queryOptions({
  queryKey: inboxKeys.item(cwd, target),
  enabled: target !== null,
  queryFn: async (): Promise<InboxItem> => {
    if (!target) throw new Error("Missing linked work item");
    const item = await githubWorkItem(cwd, target.repo, target.kind, target.number, { force: true });
    return { ...item, projectPath: cwd, provider: "github" };
  },
  initialData: () => {
    const item = target && peekGithubWorkItem(target.repo, target.kind, target.number);
    return item ? { ...item, projectPath: cwd, provider: "github" as const } : undefined;
  },
  staleTime: GITHUB_WORK_ITEM_FRESH_MS,
});

export const linearTeamsQuery = () => queryOptions({ queryKey: inboxKeys.teams, queryFn: listLinearTeams });
export const jiraProjectsQuery = () => queryOptions({ queryKey: inboxKeys.projects, queryFn: listJiraProjects });

export function inboxDetailsQuery(item: InboxItem, panel: boolean) {
  const { provider, repo, number, projectPath, id = "", identifier = "" } = item;
  const kind = item.kind === "pr" ? "pr" : "issue";
  return queryOptions<GithubWorkItemDetails>({
    queryKey: [...inboxKeys.detail(item), "body"],
    staleTime: panel ? GITHUB_WORK_ITEM_FRESH_MS : 0,
    initialData: () => (provider === "linear" ? peekLinearIssueDetails(id)
      : provider === "jira" ? peekJiraIssueDetails(identifier)
      : provider === "gitlab" ? peekGitlabWorkItemDetails(repo, kind, number)
      : provider === "azuredevops" ? peekAzureDevOpsWorkItemDetails(repo, kind, number)
      : peekGithubWorkItemDetails(repo, kind, number)) ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: () => provider === "linear" ? linearIssueDetails(id)
      : provider === "jira" ? jiraIssueDetails(identifier)
      : provider === "gitlab" ? gitlabWorkItemDetails(repo, kind, number)
      : provider === "azuredevops" ? azureDevOpsWorkItemDetails(repo, kind, number)
      : githubWorkItemDetails(projectPath, repo, kind, number),
  });
}

export function inboxThreadQuery(item: InboxItem, panel: boolean) {
  const { provider, repo, number, projectPath, id = "", identifier = "" } = item;
  const kind = item.kind === "pr" ? "pr" : "issue";
  return queryOptions({
    queryKey: [...inboxKeys.detail(item), "thread"],
    staleTime: panel ? GITHUB_WORK_ITEM_FRESH_MS : 0,
    initialData: () => (provider === "linear" ? peekLinearIssueThread(id)
      : provider === "jira" ? peekJiraIssueThread(identifier)
      : provider === "gitlab" ? peekGitlabWorkItemThread(repo, kind, number)
      : provider === "azuredevops" ? peekAzureDevOpsWorkItemThread(repo, kind, number)
      : peekGithubWorkItemThread(repo, kind, number)) ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: () => provider === "linear" ? linearIssueThread(id, { force: true })
      : provider === "jira" ? jiraIssueThread(identifier, { force: true })
      : provider === "gitlab" ? gitlabWorkItemThread(repo, kind, number, { force: true })
      : provider === "azuredevops" ? azureDevOpsWorkItemThread(repo, kind, number, { force: true })
      : githubWorkItemThread(projectPath, repo, kind, number, { force: true }),
  });
}

export function inboxDiffQuery(item: InboxItem, panel: boolean, fullContext: boolean) {
  const { provider, repo, number, projectPath } = item;
  return queryOptions({
    queryKey: [...inboxKeys.detail(item), "diff", fullContext],
    staleTime: panel ? GITHUB_WORK_ITEM_FRESH_MS : 0,
    initialData: () => (provider === "gitlab" ? peekGitlabMrDiff(repo, number)
      : provider === "azuredevops" ? peekAzureDevOpsMrDiff(repo, number)
      : peekGithubPrDiff(repo, number, fullContext)) ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: () => provider === "gitlab" ? gitlabMrDiff(repo, number)
      : provider === "azuredevops" ? azureDevOpsMrDiff(repo, number)
      : githubPrDiff(projectPath, repo, number, { fullContext }),
  });
}

export async function postInboxComment(item: InboxItem, body: string, reply?: { id: string; threadId?: string } | null) {
  const { provider, repo, number, projectPath, id = "", identifier = "" } = item;
  const kind = item.kind === "pr" ? "pr" : "issue";
  if (provider === "linear") return linearIssueComment(id, body, { parentId: reply?.id });
  if (provider === "jira") return jiraIssueComment({ id, key: identifier }, body);
  if (provider === "gitlab") return gitlabWorkItemComment(repo, kind, number, body);
  if (provider === "azuredevops") return azureDevOpsWorkItemComment(repo, kind, number, body);
  return githubWorkItemComment(projectPath, repo, kind, number, body, { inReplyTo: reply?.threadId });
}

export function updateInboxItem(next: InboxItem) {
  const key = inboxItemKey(next);
  queryClient.setQueriesData<InboxListResult>({ queryKey: inboxKeys.lists }, (current) => current && ({
    ...current, items: current.items.map((item) => inboxItemKey(item) === key ? next : item),
  }));
  queryClient.setQueriesData<InboxItem>({ queryKey: ["inbox", "item"] }, (current) =>
    current && inboxItemKey(current) === key ? next : current);
}
