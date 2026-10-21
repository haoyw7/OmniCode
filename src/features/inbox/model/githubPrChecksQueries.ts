import { queryOptions } from "@tanstack/react-query";
import { fetchGithubPrChecks, fetchGithubCheckDetails, type GithubPrCheck } from "./githubPrChecks";

export const githubPrChecksQuery = (cwd: string, repo: string, number: number) => queryOptions({
  queryKey: ["inbox", "checks", cwd, repo, number],
  // Consume the signal so leaving a PR cancels its observer's late result.
  queryFn: ({ signal }) => { signal.throwIfAborted(); return fetchGithubPrChecks(cwd, repo, number); },
});

export const githubCheckDetailsQuery = (cwd: string, repo: string, headOid: string, jobId: string, check: GithubPrCheck) => queryOptions({
  queryKey: ["inbox", "check-details", cwd, repo, headOid, jobId, check.state, check.startedAt, check.completedAt],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return fetchGithubCheckDetails(cwd, repo, jobId); },
});
