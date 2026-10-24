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

