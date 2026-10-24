export type GithubPrCheckState =
  "pass" | "fail" | "pending" | "skipping" | "cancel" | "unknown";

export type GithubPrCheck = {
  name: string;
  workflow: string;
  state: GithubPrCheckState;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type GithubPrChecks = {
  headOid: string;
  checks: GithubPrCheck[];
};

export type GithubCheckDetails = {
  steps: {
    name: string;
    state: GithubPrCheckState;
    startedAt: string | null;
    completedAt: string | null;
  }[];
  annotations: { path: string; line: number; message: string; level: string }[];
  notice: string | null;
};

