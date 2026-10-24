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
