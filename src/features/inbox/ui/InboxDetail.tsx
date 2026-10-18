import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useGithubPrChecks } from "../hooks/useGithubPrChecks";
import { summarizePrChecks } from "../model/githubPrChecks";
import type { CiRepairRequest } from "../model/ciRepair";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  ExternalLink,
  GitCompare,
  MessageSquare,
  LoaderCircle,
  MessageMultiple,
} from "../../../shared/ui/icons";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { InboxProviderMark } from "./InboxProviderMark";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  githubPrDiff,
  githubReviewDecisionLabel,
  githubWorkItemComment,
  githubWorkItemDetails,
  githubWorkItemThread,
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  inboxItemStatus,
  peekGithubPrDiff,
  peekGithubWorkItemDetails,
  peekGithubWorkItemThread,
  formatRelativeTime,
  inboxPersonAvatarUrl,
  type GithubPrDiff,
  GITHUB_WORK_ITEM_FRESH_MS,
  type GithubWorkItemDetails,
  type GithubWorkItemThread,
  type InboxItem,
} from "../model/githubTasks";
import { copyText } from "../../../platform/tauri/clipboard";
import { projectName } from "../../../shared/lib/paths";
import { playCue } from "../../settings/model/sounds";
import { sameProjectPath } from "../../projects/model/recents";
import { sessionDisplayTitle } from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  linearIssueComment,
  linearIssueDetails,
  linearIssueThread,
  peekLinearIssueDetails,
  peekLinearIssueThread,
  type LinearIssueThread,
} from "../model/linear";
import {
  jiraIssueComment,
  jiraIssueDetails,
  jiraIssueThread,
  peekJiraIssueDetails,
  peekJiraIssueThread,
  type JiraIssueThread,
} from "../model/jira";
import {
  gitlabMrDiff,
  gitlabWorkItemComment,
  gitlabWorkItemDetails,
  gitlabWorkItemThread,
  peekGitlabMrDiff,
  peekGitlabWorkItemDetails,
  peekGitlabWorkItemThread,
  type GitlabWorkItemThread,
} from "../model/gitlab";
import {
  azureDevOpsMrDiff,
  azureDevOpsWorkItemComment,
  azureDevOpsWorkItemDetails,
  azureDevOpsWorkItemThread,
  peekAzureDevOpsMrDiff,
  peekAzureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemThread,
  type AzureDevOpsWorkItemThread,
} from "../model/azureDevOps";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { InboxComments, InboxCommentForm, type InboxReplyTarget } from "./InboxComments";
import { InboxPrDiff } from "./InboxPrDiff";
import { InboxDescriptionSummary, InboxPrChangesGlance } from "./InboxPrOverview";
import { InboxPrChecks, PrChecksTab } from "./InboxPrChecks";
import { type InboxProjectOption, InboxProjectPicker } from "./InboxProjectPicker";
import { InboxLabel, inboxStatusMark } from "./InboxCard";
import { ACTION_FILLED, ACTION_GHOST, ACTION_OUTLINE, ACTION_PANEL_HEADER } from "./inboxActions";
import { GithubPrActions } from "./GithubPrActions";



function InboxDetailTab({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className="surface-tab relative flex h-7.5 items-center px-2 text-[12px] leading-none"
    >
      {label}
      {count ? (
        <span className="ml-1.5 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] tabular-nums text-content/60">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export type CiRepairProps = {
  repairSessions?: readonly SessionSummary[];
  onRepairChecks?: (
    item: InboxItem,
    request: CiRepairRequest,
    sessionId?: string,
  ) => Promise<void>;
};

export function inboxShowsFullFileDiff(item: InboxItem): boolean {
  return item.provider === "github" && item.kind === "pr";
}

export function InboxDetail({
  item,
  cwd,
  projects,
  revision,
  relatedSessions,
  mode = "inbox",
  visible = true,
  onDiscuss,
  onStart,
  repairSessions,
  onRepairChecks,
  onOpenSession,
  onItemChange,
}: {
  item: InboxItem;
  cwd: string;
  projects: InboxProjectOption[];
  revision: number;
  relatedSessions: readonly SessionSummary[];
  mode?: "inbox" | "panel";
  visible?: boolean;
  onDiscuss?: () => void;
  onStart?: (item: InboxItem, body?: string) => void | Promise<void>;
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  onItemChange?: (item: InboxItem) => void;
}) {
  const { t: uiT } = useTranslation();
  const detailLock = useLockOverscroll<HTMLDivElement>();
  const panel = mode === "panel";
  const linear = item.provider === "linear";
  const jira = item.provider === "jira";
  const tracker = linear || jira;
  const jiraKey = jira ? (item.identifier ?? "") : "";
  const gitlab = item.provider === "gitlab";
  const azuredevops = item.provider === "azuredevops";
  const isPr = !tracker && item.kind === "pr";
  const githubKind =
    item.provider === "github" && (item.kind === "issue" || item.kind === "pr")
      ? item.kind
      : null;
  const externalActionLabel =
    item.kind === "pr"
      ? gitlab
        ? "Review on GitLab"
        : azuredevops
          ? "Review on ADO"
          : "Review on GitHub"
      : linear
        ? "Open in Linear"
        : jira
          ? "Open in Jira"
          : gitlab
            ? "Open on GitLab"
            : azuredevops
              ? "Open on ADO"
              : "Open on GitHub";
  const gitlabKind =
    gitlab && (item.kind === "issue" || item.kind === "pr") ? item.kind : null;
  const azureDevOpsKind =
    azuredevops && (item.kind === "issue" || item.kind === "pr")
      ? item.kind
      : null;
  const cached = linear
    ? peekLinearIssueDetails(item.id ?? "")
    : jira
      ? peekJiraIssueDetails(jiraKey)
      : gitlabKind
        ? peekGitlabWorkItemDetails(item.repo, gitlabKind, item.number)
        : azureDevOpsKind
          ? peekAzureDevOpsWorkItemDetails(
              item.repo,
              azureDevOpsKind,
              item.number,
            )
          : githubKind
            ? peekGithubWorkItemDetails(item.repo, githubKind, item.number)
            : null;
  const cachedDiff = isPr
    ? gitlab
      ? peekGitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? peekAzureDevOpsMrDiff(item.repo, item.number)
        : peekGithubPrDiff(item.repo, item.number)
    : null;
  const cachedThread = linear
    ? peekLinearIssueThread(item.id ?? "")
    : jira
      ? peekJiraIssueThread(jiraKey)
      : gitlabKind
        ? peekGitlabWorkItemThread(item.repo, gitlabKind, item.number)
        : azureDevOpsKind
          ? peekAzureDevOpsWorkItemThread(
              item.repo,
              azureDevOpsKind,
              item.number,
            )
          : githubKind
            ? peekGithubWorkItemThread(item.repo, githubKind, item.number)
            : null;
  const [details, setDetails] = useState<GithubWorkItemDetails | null>(cached);
  const [loading, setLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "code" | "checks">("summary");
  const [diffMode, setDiffMode] = useState<"hunks" | "full">("hunks");
  // Reopening the side panel reuses recent GitHub data. Inbox keeps refetching
  // so its explicit refresh stays live.
  const panelMaxAge = panel ? GITHUB_WORK_ITEM_FRESH_MS : undefined;
  const [diffFocusPath, setDiffFocusPath] = useState<string | undefined>();
  // The panel summary lists changed files, so it shares the Code tab's fetch.
  const diffWanted = tab === "code" || (panel && tab === "summary");
  const fullFile = inboxShowsFullFileDiff(item) && diffMode === "full";
  const [prDiff, setPrDiff] = useState<GithubPrDiff | null>(cachedDiff);
  const [diffLoading, setDiffLoading] = useState(isPr && cachedDiff == null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [thread, setThread] = useState<
    | GithubWorkItemThread
    | LinearIssueThread
    | JiraIssueThread
    | GitlabWorkItemThread
    | AzureDevOpsWorkItemThread
    | null
  >(cachedThread);
  const [threadLoading, setThreadLoading] = useState(cachedThread == null);
  const [threadError, setThreadError] = useState<string | null>(null);
  // A long thread's Markdown renders interruptibly instead of blocking input
  // as it arrives. The deferred copy carries its item, so switching items
  // shows the pending state rather than the previous item's comments.
  const threadKey = inboxItemKey(item);
  const threadView = useMemo(
    () => ({ key: threadKey, thread }),
    [threadKey, thread],
  );
  const shownThreadView = useDeferredValue(threadView);
  const shownThread =
    shownThreadView.key === threadKey ? shownThreadView.thread : null;
  const threadRendering = shownThreadView !== threadView && shownThread == null;
  const [replyTo, setReplyTo] = useState<InboxReplyTarget | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const defaultProject =
    projects.find((project) => sameProjectPath(project.path, cwd))?.path ??
    projects[0]?.path ??
    cwd;
  const [startProject, setStartProject] = useState(defaultProject);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const chooseStartProject =
    tracker || ((gitlab || azuredevops) && !item.projectPath);
  const status = tracker
    ? item.state || inboxItemStatus(item)
    : inboxItemStatus(item);
  const statusMark = inboxStatusMark(item);

  const source = tracker
    ? item.teamName || item.repo
    : item.repo || projectName(item.projectPath);
  const attentionLabel =
    gitlab || azuredevops
      ? gitlabAttentionLabel(item.attentionReason ?? "")
      : "";
  const markdownCwd = chooseStartProject
    ? startProject || cwd
    : item.projectPath || cwd;
  const authorName = details?.author?.trim() ?? "";
  const extraAssignees = item.assignees.filter(
    (person) =>
      !authorName ||
      person.login.trim().toLowerCase() !== authorName.toLowerCase(),
  );
  const showAssignment =
    extraAssignees.length > 0 || item.assignees.length === 0;
  const reviewDecision =
    details?.reviewDecision?.trim() || thread?.reviewDecision?.trim() || "";
  const reviewLabel = githubReviewDecisionLabel(reviewDecision);
  const reviewClass =
    reviewDecision.toUpperCase() === "APPROVED"
      ? "text-emerald-400/90"
      : reviewDecision.toUpperCase() === "CHANGES_REQUESTED"
        ? "text-rose-400/90"
        : "text-content/50";
  const baseRef =
    details?.baseRefName?.trim() || thread?.baseRefName?.trim() || "";
  const headRef =
    details?.headRefName?.trim() || thread?.headRefName?.trim() || "";

  // Checks load as soon as a GitHub PR is open, whatever tab is active. The
  // panel passes revision 0, so its loads ride on mount and the identity key.
  const prChecksEnabled = githubKind === "pr";
  const prChecksView = useGithubPrChecks({
    cwd: item.projectPath || cwd,
    repo: item.repo,
    number: item.number,
    enabled: prChecksEnabled,
    open: isPr && item.state.trim().toLowerCase() === "open",
    poll: visible && tab === "checks",
    revision,
  });
  const prChecksOverall = prChecksEnabled
    ? summarizePrChecks({
        loading: prChecksView.loading,
        error: prChecksView.error,
        checks: prChecksView.checks?.checks ?? null,
      })
    : null;

  useEffect(() => {
    let cancelled = false;
    const cachedDetails = linear
      ? peekLinearIssueDetails(item.id ?? "")
      : jira
        ? peekJiraIssueDetails(jiraKey)
        : gitlabKind
          ? peekGitlabWorkItemDetails(item.repo, gitlabKind, item.number)
          : azureDevOpsKind
            ? peekAzureDevOpsWorkItemDetails(
                item.repo,
                azureDevOpsKind,
                item.number,
              )
            : githubKind
              ? peekGithubWorkItemDetails(item.repo, githubKind, item.number)
              : null;
    if (cachedDetails) {
      setDetails(cachedDetails);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
      setDetails(null);
    }
    const pending = linear
      ? item.id
        ? linearIssueDetails(item.id)
        : Promise.reject(new Error("Missing Linear issue"))
      : jira
        ? jiraKey
          ? jiraIssueDetails(jiraKey)
          : Promise.reject(new Error("Missing Jira issue"))
        : gitlabKind
          ? gitlabWorkItemDetails(item.repo, gitlabKind, item.number)
          : azureDevOpsKind
            ? azureDevOpsWorkItemDetails(
                item.repo,
                azureDevOpsKind,
                item.number,
              )
            : githubKind
              ? githubWorkItemDetails(
                  item.projectPath,
                  item.repo,
                  githubKind,
                  item.number,
                  { maxAgeMs: panelMaxAge },
                )
              : Promise.reject(new Error("Unknown inbox item"));
    void pending
      .then((next) => {
        if (cancelled) return;
        setDetails(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedDetails) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azureDevOpsKind,
    githubKind,
    gitlabKind,
    item.id,
    item.number,
    item.projectPath,
    item.repo,
    jira,
    jiraKey,
    linear,
    panelMaxAge,
    revision,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (linear) {
      const id = item.id ?? "";
      const cachedThread = peekLinearIssueThread(id);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void linearIssueThread(id)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (cachedThread) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (jira) {
      const cachedThread = peekJiraIssueThread(jiraKey);
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void jiraIssueThread(jiraKey)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (cachedThread) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (gitlabKind) {
      const cachedThread = peekGitlabWorkItemThread(
        item.repo,
        gitlabKind,
        item.number,
      );
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void gitlabWorkItemThread(item.repo, gitlabKind, item.number)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (cachedThread) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (azureDevOpsKind) {
      const cachedThread = peekAzureDevOpsWorkItemThread(
        item.repo,
        azureDevOpsKind,
        item.number,
      );
      if (cachedThread) {
        setThread(cachedThread);
        setThreadLoading(false);
        setThreadError(null);
      } else {
        setThreadLoading(true);
        setThreadError(null);
        setThread(null);
      }
      void azureDevOpsWorkItemThread(item.repo, azureDevOpsKind, item.number)
        .then((next) => {
          if (cancelled) return;
          setThread(next);
          setThreadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (cachedThread) return;
          setThreadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (!githubKind) return;
    const cachedThread = peekGithubWorkItemThread(
      item.repo,
      githubKind,
      item.number,
    );
    if (cachedThread) {
      setThread(cachedThread);
      setThreadLoading(false);
      setThreadError(null);
    } else {
      setThreadLoading(true);
      setThreadError(null);
      setThread(null);
    }
    void githubWorkItemThread(
      item.projectPath,
      item.repo,
      githubKind,
      item.number,
      { maxAgeMs: panelMaxAge },
    )
      .then((next) => {
        if (cancelled) return;
        setThread(next);
        setThreadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedThread) return;
        setThreadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azureDevOpsKind,
    githubKind,
    gitlabKind,
    item.id,
    item.number,
    item.projectPath,
    item.repo,
    jira,
    jiraKey,
    linear,
    panelMaxAge,
    revision,
  ]);

  useEffect(() => {
    if (!isPr || !diffWanted) return;
    let cancelled = false;
    const cachedDiff = gitlab
      ? peekGitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? peekAzureDevOpsMrDiff(item.repo, item.number)
        : peekGithubPrDiff(item.repo, item.number, fullFile);
    if (cachedDiff) {
      setPrDiff(cachedDiff);
      setDiffLoading(false);
      setDiffError(null);
    } else {
      setDiffLoading(true);
      setDiffError(null);
      setPrDiff(null);
    }
    const pending = gitlab
      ? gitlabMrDiff(item.repo, item.number)
      : azuredevops
        ? azureDevOpsMrDiff(item.repo, item.number)
        : githubPrDiff(item.projectPath, item.repo, item.number, {
            fullContext: fullFile,
            maxAgeMs: panelMaxAge,
          });
    void pending
      .then((next) => {
        if (cancelled) return;
        setPrDiff(next);
        setDiffError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (cachedDiff) return;
        setDiffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    azuredevops,
    diffWanted,
    fullFile,
    gitlab,
    isPr,
    item.number,
    item.projectPath,
    item.repo,
    panelMaxAge,
    revision,
  ]);

  // The side panel reveals its overview in one piece rather than letting the
  // description, files and activity land and reshuffle one after another.
  const overviewSettling =
    panel && (loading || threadLoading || (isPr && diffLoading));

  const postComment = async (body: string) => {
    setPosting(true);
    setPostError(null);
    try {
      if (linear) {
        const id = item.id ?? "";
        await linearIssueComment(id, body, { parentId: replyTo?.id });
        setReplyTo(null);
        try {
          setThread(await linearIssueThread(id, { force: true }));
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (jira) {
        await jiraIssueComment({ id: item.id ?? "", key: jiraKey }, body);
        setReplyTo(null);
        try {
          setThread(await jiraIssueThread(jiraKey, { force: true }));
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (gitlabKind) {
        await gitlabWorkItemComment(item.repo, gitlabKind, item.number, body);
        setReplyTo(null);
        try {
          setThread(
            await gitlabWorkItemThread(item.repo, gitlabKind, item.number, {
              force: true,
            }),
          );
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (azureDevOpsKind) {
        await azureDevOpsWorkItemComment(
          item.repo,
          azureDevOpsKind,
          item.number,
          body,
        );
        setReplyTo(null);
        try {
          setThread(
            await azureDevOpsWorkItemThread(
              item.repo,
              azureDevOpsKind,
              item.number,
              {
                force: true,
              },
            ),
          );
        } catch (err: unknown) {
          setPostError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (!githubKind) throw new Error("Unknown inbox item");
      await githubWorkItemComment(
        item.projectPath,
        item.repo,
        githubKind,
        item.number,
        body,
        { inReplyTo: replyTo?.threadId },
      );
      setReplyTo(null);
      try {
        setThread(
          await githubWorkItemThread(
            item.projectPath,
            item.repo,
            githubKind,
            item.number,
            {
              force: true,
            },
          ),
        );
      } catch (err: unknown) {
        setPostError(err instanceof Error ? err.message : String(err));
      }
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setPosting(false);
    }
  };

  const identityRow = (
    <div
      data-inbox-detail-identity
      data-inbox-detail-fixed-header={panel ? "" : undefined}
      className={`flex min-w-0 items-center gap-2 text-[12px] text-content/50 ${
        panel ? "h-9 shrink-0 border-b border-stroke px-4 pr-[34px]" : ""
      }`}
    >
      <InboxProviderMark
        provider={item.provider}
        className="size-3.5 shrink-0"
      />
      <span className="shrink-0">
        {item.kind === "pr"
          ? gitlab
            ? uiT("Merge request")
            : uiT("Pull request")
          : uiT("Issue")}
      </span>
      <span className="shrink-0 tabular-nums">{inboxItemRef(item)}</span>
      <span
        className={`flex shrink-0 items-center gap-1 ${statusMark.className}`}
      >
        <statusMark.Icon className="size-3.5" strokeWidth={1.75} />
        {status}
      </span>
      {attentionLabel ? (
        <span className="shrink-0 text-accent">{attentionLabel}</span>
      ) : null}
      {source ? <span className="min-w-0 truncate">{source}</span> : null}
      {panel ? (
        <button
          type="button"
          title={item.url ? externalActionLabel : uiT("No link available")}
          aria-label={externalActionLabel}
          disabled={!item.url}
          onClick={() => void openUrl(item.url)}
          className={`${ACTION_PANEL_HEADER} ml-auto shrink-0 disabled:opacity-40`}
        >
          <ExternalLink className="size-3.5" />
          <span className="@max-[420px]/linked:hidden">
            {externalActionLabel}
          </span>
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {panel ? identityRow : null}
      <div
        ref={panel ? detailLock : undefined}
        data-inbox-detail-scroll={panel ? "" : undefined}
        className={
          panel
            ? "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
            : "contents"
        }
      >
        <div
          data-inbox-detail-header
          className={`relative border-b border-stroke ${
            panel ? "" : "z-10 shrink-0"
          }`}
        >
          <div
            className={`mx-auto flex w-full max-w-5xl flex-col ${
              panel ? "gap-2 px-4 pt-4" : "gap-2.5 px-8 pt-5"
            } ${isPr ? "" : panel ? "pb-4" : "pb-5"}`}
          >
            <header className={`flex flex-col ${panel ? "gap-2" : "gap-2.5"}`}>
              {panel ? null : identityRow}
              <h1
                title={item.title}
                className={`line-clamp-2 font-semibold leading-tight text-content ${
                  panel ? "text-[18px]" : "text-[20px]"
                }`}
              >
                {item.title}
              </h1>
              <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[12px] text-content/50">
                {authorName ? (
                  <InboxPerson
                    name={authorName}
                    avatarUrl={inboxPersonAvatarUrl(
                      item.provider,
                      authorName,
                      details?.authorAvatarUrl,
                    )}
                    size={16}
                  />
                ) : null}
                {showAssignment ? (
                  <>
                    {authorName ? <span aria-hidden>·</span> : null}
                    {extraAssignees.length > 0 ? (
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                        {extraAssignees.map((person) => (
                          <InboxPerson
                            key={person.login}
                            name={person.login}
                            avatarUrl={inboxPersonAvatarUrl(
                              item.provider,
                              person.login,
                              person.avatarUrl,
                            )}
                            size={16}
                          />
                        ))}
                      </span>
                    ) : (
                      <span>{uiT("Unassigned")}</span>
                    )}
                  </>
                ) : null}
                {item.createdAt && formatRelativeTime(item.createdAt) ? (
                  <>
                    <span aria-hidden>·</span>
                    <time
                      dateTime={item.createdAt}
                      title={new Date(item.createdAt).toLocaleString()}
                    >
                      {uiT("Created ")}
                      {formatRelativeTime(item.createdAt)}
                    </time>
                  </>
                ) : null}
                {formatRelativeTime(item.updatedAt) ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {uiT("Updated ")}
                      {formatRelativeTime(item.updatedAt)}
                    </span>
                  </>
                ) : null}
                {baseRef && headRef ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <GitCompare
                        className="size-3 shrink-0"
                      />
                      <span className="min-w-0 truncate">
                        {baseRef} ← {headRef}
                      </span>
                      <CopyBranchNameButton branch={headRef} />
                    </span>
                  </>
                ) : null}
                {reviewLabel ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className={reviewClass}>{reviewLabel}</span>
                  </>
                ) : null}
              </div>
              {!panel && relatedSessions.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="mr-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-content/45">
                    <MessageMultiple className="size-3.5" />
                    {uiT("Related")}{" "}
                    {relatedSessions.length === 1
                      ? uiT("thread")
                      : uiT("threads")}
                  </span>
                  {relatedSessions.map((session) => {
                    const title = sessionDisplayTitle(
                      session.title,
                      session.harness,
                    );
                    return (
                      <button
                        key={session.id}
                        type="button"
                        title={uiT("Open thread: {value0}", {
                          value0: String(title),
                        })}
                        onClick={() => void onOpenSession?.(session.id)}
                        className="inline-flex min-w-0 max-w-64 items-center gap-1 rounded-md bg-content/5 px-2 py-1 text-[11px] text-content/70 hover:bg-content/6 hover:text-content"
                      >
                        <span className="truncate">{title}</span>
                        {session.archived ? (
                          <span className="shrink-0 text-content/40">
                            {uiT("Archived")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {onStart && item.kind !== "pr" ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        starting ||
                        (chooseStartProject &&
                          (projects.length === 0 ||
                            !startProject ||
                            loading ||
                            !!error))
                      }
                      onClick={() => {
                        if (starting) return;
                        setStarting(true);
                        setStartError(null);
                        const next = chooseStartProject
                          ? { ...item, projectPath: startProject }
                          : item;
                        void Promise.resolve(
                          onStart(next, tracker ? details?.body : undefined),
                        )
                          .catch((err: unknown) => {
                            setStartError(
                              err instanceof Error ? err.message : String(err),
                            );
                          })
                          .finally(() => setStarting(false));
                      }}
                      className={`${ACTION_FILLED} disabled:cursor-default disabled:opacity-40`}
                    >
                      {starting ? uiT("Sending...") : uiT("Send to agent")}
                    </button>
                    {chooseStartProject ? (
                      <InboxProjectPicker
                        projects={projects}
                        value={startProject}
                        onChange={setStartProject}
                      />
                    ) : null}
                  </>
                ) : null}
                {githubKind === "pr" ? (
                  <GithubPrActions
                    item={item}
                    baseRef={baseRef}
                    headRef={headRef}
                    onChange={onItemChange}
                  />
                ) : null}
                {onDiscuss ? (
                  <button
                    type="button"
                    onClick={onDiscuss}
                    className={ACTION_OUTLINE}
                  >
                    <MessageSquare className="size-3.5" />{" "}
                    {uiT("Ask")}
                  </button>
                ) : null}
                {panel ? null : (
                  <button
                    type="button"
                    title={
                      item.url ? externalActionLabel : uiT("No link available")
                    }
                    disabled={!item.url}
                    onClick={() => void openUrl(item.url)}
                    className={`${ACTION_GHOST} disabled:opacity-40`}
                  >
                    <ExternalLink className="size-3.5" />
                    {externalActionLabel}
                  </button>
                )}
              </div>
              {startError ? (
                <p className="text-[12px] text-red-400/90">{startError}</p>
              ) : null}
            </header>
            {isPr ? (
              <div className="flex h-9 items-stretch gap-4">
                <div
                  role="tablist"
                  aria-label={
                    gitlab
                      ? uiT("Merge request sections")
                      : uiT("Pull request sections")
                  }
                  className="flex items-stretch gap-4"
                >
                  <InboxDetailTab
                    label={uiT("Summary")}
                    selected={tab === "summary"}
                    onSelect={() => setTab("summary")}
                  />
                  <InboxDetailTab
                    label={uiT("Code")}
                    count={panel ? prDiff?.files.length : undefined}
                    selected={tab === "code"}
                    onSelect={() => {
                      setDiffFocusPath(undefined);
                      setTab("code");
                    }}
                  />
                  {prChecksOverall ? (
                    <PrChecksTab
                      overall={prChecksOverall}
                      selected={tab === "checks"}
                      onSelect={() => setTab("checks")}
                    />
                  ) : null}
                </div>
                {tab === "code" && inboxShowsFullFileDiff(item) ? (
                  <div
                    role="group"
                    aria-label={uiT("Diff context")}
                    className="ml-auto flex items-center self-center rounded-md border border-content/10 bg-content/[0.03] p-0.5"
                  >
                    <button
                      type="button"
                      aria-pressed={diffMode === "hunks"}
                      onClick={() => setDiffMode("hunks")}
                      className={`rounded px-2.5 py-1 text-[11px] leading-none ${
                        diffMode === "hunks"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70"
                      }`}
                    >
                      {uiT("Hunks")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={diffMode === "full"}
                      onClick={() => setDiffMode("full")}
                      className={`rounded px-2.5 py-1 text-[11px] leading-none ${
                        diffMode === "full"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70"
                      }`}
                    >
                      {uiT("Full file")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          ref={panel ? undefined : detailLock}
          data-inbox-detail-scroll={panel ? undefined : ""}
          className={
            panel
              ? "min-w-0"
              : "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
          }
        >
          <div
            className={`mx-auto flex w-full max-w-5xl flex-col ${
              panel ? "gap-6 px-4 py-5" : "gap-5 px-8 py-5"
            }`}
          >
            {item.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {item.labels.map((label) => (
                  <InboxLabel key={label.name} label={label} />
                ))}
              </div>
            ) : null}
            {isPr && tab === "code" ? (
              diffLoading ? (
                <div className="flex justify-center py-10 text-content/40">
                  <LoaderCircle
                    className="size-4 animate-spin"
                  />
                </div>
              ) : diffError ? (
                <p className="text-[13px] text-content/50">{diffError}</p>
              ) : prDiff ? (
                <InboxPrDiff
                  key={`${item.projectPath}:${item.number}:${revision}:${diffMode}`}
                  diff={prDiff}
                  fullFile={fullFile}
                  focusPath={diffFocusPath}
                />
              ) : (
                <p className="text-[13px] text-content/45">
                  {uiT("No file changes")}
                </p>
              )
            ) : isPr && tab === "checks" ? (
              <InboxPrChecks
                view={prChecksView}
                onRefresh={prChecksView.refresh}
                cwd={item.projectPath || cwd}
                repo={item.repo}
                repair={
                  onRepairChecks &&
                  item.provider === "github" &&
                  item.projectPath
                    ? {
                        number: item.number,
                        onOpenSession,
                        sessions: (repairSessions ?? []).filter(
                          (session) =>
                            !session.archived &&
                            !session.orchestrationLeadId &&
                            sameProjectPath(session.cwd, item.projectPath),
                        ),
                        onStart: (request, sessionId) =>
                          onRepairChecks(item, request, sessionId),
                      }
                    : undefined
                }
              />
            ) : loading || overviewSettling ? (
              <div className="flex justify-center py-10 text-content/40">
                <LoaderCircle
                  className="size-4 animate-spin"
                />
              </div>
            ) : error ? (
              <p className="text-[13px] text-content/50">{error}</p>
            ) : (
              <>
                {panel ? (
                  <InboxDescriptionSummary
                    body={details?.body ?? ""}
                    cwd={markdownCwd}
                  />
                ) : details?.body.trim() ? (
                  <AgentMarkdown
                    text={details.body}
                    cwd={markdownCwd}
                    allowRemoteMedia
                  />
                ) : (
                  <p className="text-[13px] text-content/45">
                    {uiT("No description")}
                  </p>
                )}
                {panel && isPr ? (
                  <InboxPrChangesGlance
                    diff={prDiff}
                    loading={diffLoading}
                    error={diffError}
                    onOpenFile={(path) => {
                      setDiffFocusPath(path);
                      setTab("code");
                    }}
                  />
                ) : null}
                <InboxComments
                  thread={shownThread}
                  loading={threadLoading || threadRendering}
                  error={threadError}
                  cwd={markdownCwd}
                  provider={item.provider}
                  replyMode={
                    linear
                      ? "parent"
                      : jira || gitlab || azuredevops
                        ? undefined
                        : "thread"
                  }
                  onReply={setReplyTo}
                />
                <InboxCommentForm
                  replyTo={replyTo}
                  posting={posting}
                  error={postError}
                  onCancelReply={() => {
                    setReplyTo(null);
                    setPostError(null);
                  }}
                  onSubmit={postComment}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyBranchNameButton({ branch }: { branch: string }) {
  const { t: uiT } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [branch]);

  return (
    <button
      type="button"
      title={copied ? uiT("Copied") : uiT("Copy branch name")}
      aria-label={copied ? uiT("Copied") : uiT("Copy branch name")}
      className="shrink-0 rounded p-0.5 text-content/40 hover:bg-content/5 hover:text-content/70"
      onClick={() => {
        void copyText(branch).then(
          () => {
            playCue("copy");
            setCopied(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        );
      }}
    >
      {copied ? (
        <Check className="size-3" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

function InboxPerson({
  name,
  avatarUrl,
  size = 20,
  className = "",
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(!avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    setFailed(!avatarUrl);
  }, [avatarUrl]);

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="shrink-0 rounded-full bg-content/10 object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="grid shrink-0 place-items-center rounded-full bg-content/12 font-medium text-content/55"
          style={{
            width: size,
            height: size,
            fontSize: Math.max(9, Math.round(size * 0.45)),
          }}
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
