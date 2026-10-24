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

