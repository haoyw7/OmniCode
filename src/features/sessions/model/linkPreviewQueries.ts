import { queryOptions } from "@tanstack/react-query";
import type { GithubWorkItemLink } from "./linkPreview";
import { githubWorkItem, githubWorkItemDetails, peekGithubWorkItem, peekGithubWorkItemDetails } from "../../inbox/model/githubTasks";

export const linkPreviewKeys = {
  metadata: (url: string) => ["linkPreview", "metadata", url] as const,
  github: (cwd: string, item: GithubWorkItemLink, part: string) => ["linkPreview", "github", cwd, item.repo, item.kind, item.number, part] as const,
};
export const githubLinkItemQuery = (cwd: string, item: GithubWorkItemLink) => queryOptions({
  queryKey: linkPreviewKeys.github(cwd, item, "item"),
  queryFn: () => githubWorkItem(cwd, item.repo, item.kind, item.number),
  initialData: () => peekGithubWorkItem(item.repo, item.kind, item.number) ?? undefined,
  staleTime: Infinity,
});
export const githubLinkDetailsQuery = (cwd: string, item: GithubWorkItemLink) => queryOptions({
  queryKey: linkPreviewKeys.github(cwd, item, "details"),
  queryFn: () => githubWorkItemDetails(cwd, item.repo, item.kind, item.number),
  initialData: () => peekGithubWorkItemDetails(item.repo, item.kind, item.number) ?? undefined,
  staleTime: Infinity,
});
