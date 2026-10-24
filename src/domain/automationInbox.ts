import type { Automation, AutomationTrigger, AutomationTriggerKind } from "../contracts/automations";
import type { AzureDevOpsWorkItem } from "../contracts/azureDevOps";
import type { GitlabWorkItem } from "../contracts/gitlab";
import type { JiraIssue } from "../contracts/jira";
import type { LinearIssue } from "../contracts/linear";
import type { InboxItem, LinkedWorkItem } from "../contracts/session";
import { automationTriggers } from "./automationSchedule";
import { normalizeProjectPath } from "./pathDisplay";
import { githubUrl, validNumber } from "./workItemIdentity";

export type InboxAutomationMatch = {
  automation: Automation;
  trigger: AutomationTrigger;
  item: InboxItem;
  eventKey: string;
  occurredAt: number;
  prompt: string;
};

export const SUPPORTED_INBOX_TRIGGER_EVENTS = {
  github: ["draft_opened", "pull_request_opened", "issue_opened"],
  gitlab: ["merge_request_opened", "issue_opened"],
  linear: ["issue_created"],
  jira: ["issue_created"],
  azuredevops: ["pull_request_appeared", "work_item_appeared"],
} as const;

export function inboxAppearedEvent(
  item: InboxItem,
): { kind: AutomationTriggerKind; event: string } | null {
  if (item.provider === "github" && item.kind === "pr") {
    return {
      kind: "github",
      event: item.draft ? "draft_opened" : "pull_request_opened",
    };
  }
  if (item.provider === "github" && item.kind === "issue") {
    return { kind: "github", event: "issue_opened" };
  }
  if (item.provider === "gitlab" && item.kind === "pr") {
    return { kind: "gitlab", event: "merge_request_opened" };
  }
  if (item.provider === "gitlab" && item.kind === "issue") {
    return { kind: "gitlab", event: "issue_opened" };
  }
  if (item.provider === "linear" || item.provider === "jira") {
    return { kind: item.provider, event: "issue_created" };
  }
  if (item.provider === "azuredevops" && item.kind === "pr") {
    return { kind: "azuredevops", event: "pull_request_appeared" };
  }
  if (item.provider === "azuredevops" && item.kind === "issue") {
    return { kind: "azuredevops", event: "work_item_appeared" };
  }
  return null;
}

export function automationEventKey(item: InboxItem): string {
  const identity =
    item.provider === "linear" || item.provider === "jira"
      ? `${item.provider}:issue:${item.id || item.identifier || item.number}`
      : `${item.provider}:${item.kind}:${item.repo}:${item.number}`;
  return identity
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\-./]/g, "_")
    .slice(0, 400);
}

export function matchInboxAutomations(
  automations: readonly Automation[],
  appeared: readonly InboxItem[],
): InboxAutomationMatch[] {
  const matches: InboxAutomationMatch[] = [];
  const seen = new Set<string>();
  for (const item of appeared) {
    const event = inboxAppearedEvent(item);
    if (!event) continue;
    const eventKey = automationEventKey(item);
    if (!eventKey) continue;
    for (const automation of automations) {
      if (!automation.enabled) continue;
      const trigger = automationTriggers(automation).find((candidate) =>
        triggerMatchesInboxItem(candidate, automation.cwd, item, event),
      );
      if (!trigger) continue;
      const dedupe = `${automation.id}:${eventKey}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      matches.push({
        automation,
        trigger,
        item,
        eventKey,
        occurredAt: inboxItemOccurredAt(item),
        prompt: `${automation.prompt.trim()}\n\n${inboxStartDraft(item).trim()}`,
      });
    }
  }
  return matches;
}

function triggerMatchesInboxItem(
  trigger: AutomationTrigger,
  cwd: string,
  item: InboxItem,
  event: { kind: AutomationTriggerKind; event: string },
): boolean {
  if (trigger.kind !== event.kind || trigger.event !== event.event) return false;
  if (!matchesInboxProject(item, cwd)) return false;
  if (!matchesActor(trigger.actor)) return false;
  const repos = [...trigger.repos, trigger.repo]
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean);
  if (repos.length === 0) return true;
  return repos.includes(item.repo.trim().toLowerCase());
}

function projectPathKey(path: string): string {
  const normalized = normalizeProjectPath(path);
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

function matchesInboxProject(item: InboxItem, cwd: string): boolean {
  // Linear and Jira issues have no git path. The automation's own
  // project is the workspace the agent should run in.
  if (
    (item.provider === "linear" || item.provider === "jira") &&
    !item.projectPath.trim()
  ) return true;
  return projectPathKey(item.projectPath) === projectPathKey(cwd);
}

function matchesActor(actor: string): boolean {
  const value = actor.trim().toLowerCase();
  return value.length === 0 || value === "anyone";
}

export function inboxItemOccurredAt(item: InboxItem): number {
  const created = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  if (Number.isFinite(created)) return created;
  const updated = Date.parse(item.updatedAt);
  return Number.isFinite(updated) ? updated : 0;
}

export function inboxStartDraft(item: InboxItem, body?: string): string {
  if (item.provider === "linear" || item.provider === "jira") {
    const provider = item.provider === "jira" ? "Jira" : "Linear";
    const id = item.identifier?.trim() || `${provider} #${item.number}`;
    const title = item.title.trim() || id;
    const lines = [`Work on this ${provider} issue:`, "", `${id} ${title}`];
    const url = item.url.trim();
    if (url) lines.push(url);
    const description = body?.trim();
    if (description) {
      lines.push("", description);
    }
    return `${lines.join("\n")}\n`;
  }
  const kind = item.kind === "pr" ? "pull request" : "issue";
  const provider =
    item.provider === "gitlab"
      ? "GitLab"
      : item.provider === "azuredevops"
        ? "ADO"
        : "GitHub";
  const providerKind =
    item.provider === "gitlab" && item.kind === "pr" ? "merge request" : kind;
  const title =
    item.title.trim() || `${provider} ${providerKind} #${item.number}`;
  const lines = [
    `Work on this ${provider} ${providerKind}:`,
    "",
    `#${item.number} ${title}`,
  ];
  const url = item.url.trim();
  if (url) lines.push(url);
  return `${lines.join("\n")}\n`;
}

export function linearIssueToInboxItem(issue: LinearIssue): InboxItem {
  return {
    provider: "linear",
    kind: "linear",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectId: issue.projectId || "",
    projectName: issue.projectName || "",
    projectPath: issue.projectPath || "",
  };
}

export function jiraIssueToInboxItem(issue: JiraIssue): InboxItem {
  return {
    provider: "jira",
    kind: "jira",
    id: issue.id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateType: issue.stateType,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    assignees: issue.assignees,
    draft: false,
    repo: issue.repo,
    teamId: issue.teamId,
    teamName: issue.teamName,
    projectPath: issue.projectPath || "",
  };
}

export function gitlabWorkItemToInboxItem(
  item: GitlabWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "gitlab",
    repo: item.repo || repo,
    projectPath,
  };
}

export function azureDevOpsWorkItemToInboxItem(
  item: AzureDevOpsWorkItem,
  projectPath: string,
  repo: string,
): InboxItem {
  return {
    ...item,
    provider: "azuredevops",
    repo: item.repo || repo,
    projectPath,
  };
}

/** Restore the GitHub identity persisted on an event-triggered automation run. */
export function linkedWorkItemFromAutomationEvent(run: {
  trigger: string;
  eventKind?: string;
  eventKey?: string;
}): LinkedWorkItem | null {
  if (run.trigger !== "event" || run.eventKind !== "github") return null;
  const match = /^github:(pr|issue):([^/:]+\/[^/:]+):([1-9]\d*)$/i.exec(
    run.eventKey?.trim() ?? "",
  );
  if (!match) return null;
  const number = Number(match[3]);
  if (!validNumber(number)) return null;
  const kind = match[1].toLowerCase() === "pr" ? "pr" : "issue";
  const repo = match[2];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { kind, repo, number, url: githubUrl(repo, kind, number) };
}
