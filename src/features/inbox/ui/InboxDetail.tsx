import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { inboxKeys, inboxDetailsQuery, inboxThreadQuery, inboxDiffQuery, postInboxComment } from "../model/inboxQueries";
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
  MessageMultiple,
} from "../../../shared/ui/icons";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { InboxProviderMark } from "./InboxProviderMark";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  githubReviewDecisionLabel,
  gitlabAttentionLabel,
  inboxItemKey,
  inboxItemRef,
  inboxItemStatus,
  formatRelativeTime,
  inboxPersonAvatarUrl,
  type InboxItem,
} from "../model/githubTasks";
import { copyText } from "../../../platform/tauri/clipboard";
import { projectName } from "../../../shared/lib/paths";
import { playCue } from "../../settings/model/sounds";
import { sameProjectPath } from "../../projects/model/recents";
import { sessionDisplayTitle } from "../../sessions/model/session";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { InboxComments, InboxCommentForm, type InboxReplyTarget } from "./InboxComments";
import { InboxPrDiff } from "./InboxPrDiff";
import { InboxDescriptionSummary, InboxPrChangesGlance } from "./InboxPrOverview";
import { InboxPrChecks, PrChecksTab } from "./InboxPrChecks";
import { type InboxProjectOption, InboxProjectPicker } from "./InboxProjectPicker";
import { InboxLabel, inboxStatusMark } from "./InboxCard";
import { GithubPrActions } from "./GithubPrActions";
import { Spinner } from "../../../shared/ui/primitives/Spinner";



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
    <Button variant="ghost" size="content"
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
    </Button>
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
  const detailsQuery = useQuery(inboxDetailsQuery(item, panel), queryClient);
  const details = detailsQuery.data ?? null;
  const loading = detailsQuery.isPending;
  const error = details ? null : errorMessage(detailsQuery.error) ?? null;
  const [tab, setTab] = useState<"summary" | "code" | "checks">("summary");
  const [diffMode, setDiffMode] = useState<"hunks" | "full">("hunks");
  const [diffFocusPath, setDiffFocusPath] = useState<string | undefined>();
  // The panel summary lists changed files, so it shares the Code tab's fetch.
  const diffWanted = tab === "code" || (panel && tab === "summary");
  const fullFile = inboxShowsFullFileDiff(item) && diffMode === "full";
  const diffQuery = useQuery({ ...inboxDiffQuery(item, panel, fullFile), enabled: isPr && diffWanted }, queryClient);
  const prDiff = diffQuery.data ?? null;
  const diffLoading = isPr && diffQuery.isPending;
  const diffError = prDiff ? null : errorMessage(diffQuery.error) ?? null;
  const threadQuery = useQuery(inboxThreadQuery(item, panel), queryClient);
  const thread = threadQuery.data ?? null;
  const threadLoading = threadQuery.isPending;
  const threadError = thread ? null : errorMessage(threadQuery.error) ?? null;
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
  const commentMutation = useMutation({
    mutationFn: ({ body, target, reply }: { body: string; target: InboxItem; reply: InboxReplyTarget | null }) =>
      postInboxComment(target, body, reply),
    onSuccess: async (_result, { target }) => {
      setReplyTo(null);
      toast.success(uiT("Comment posted"));
      await invalidateAfterChange(inboxKeys.detail(target));
    },
    onError: (reason) => toast.error(errorMessage(reason)),
  }, queryClient);
  const posting = commentMutation.isPending;
  const postError = errorMessage(commentMutation.error) ?? null;
  const defaultProject =
    projects.find((project) => sameProjectPath(project.path, cwd))?.path ??
    projects[0]?.path ??
    cwd;
  const [startProject, setStartProject] = useState(defaultProject);
  const startMutation = useMutation({
    mutationFn: async ({ target, body }: { target: InboxItem; body?: string }) => { await onStart?.(target, body); },
  }, queryClient);
  const starting = startMutation.isPending;
  const startError = errorMessage(startMutation.error) ?? null;
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

  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    void invalidateAfterChange(inboxKeys.detail(item));
  }, [revision, item]);

  // The side panel reveals its overview in one piece rather than letting the
  // description, files and activity land and reshuffle one after another.
  const overviewSettling =
    panel && (loading || threadLoading || (isPr && diffLoading));

  const postComment = (body: string) =>
    commentMutation.mutateAsync({ body, target: item, reply: replyTo }).then(() => {});

  const identityRow = (
    <div
      data-inbox-detail-identity
      data-inbox-detail-fixed-header={panel ? "" : undefined}
      className={cn("flex min-w-0 items-center gap-2 text-[12px] text-content/50", panel ? "h-9 shrink-0 border-b border-stroke px-4 pr-[34px]" : "")}
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
        className={cn("flex shrink-0 items-center gap-1", statusMark.className)}
      >
        <statusMark.Icon className="size-3.5" strokeWidth={1.75} />
        {status}
      </span>
      {attentionLabel ? (
        <span className="shrink-0 text-accent">{attentionLabel}</span>
      ) : null}
      {source ? <span className="min-w-0 truncate">{source}</span> : null}
      {panel ? (
        <Button
          type="button"
          title={item.url ? externalActionLabel : uiT("No link available")}
          aria-label={externalActionLabel}
          disabled={!item.url}
          onClick={() => void openUrl(item.url)}
          variant="ghost" size="md" className={cn("ml-auto shrink-0 disabled:opacity-40")}
        >
          <ExternalLink className="size-3.5" />
          <span className="@max-[420px]/linked:hidden">
            {externalActionLabel}
          </span>
        </Button>
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
          className={cn("relative border-b border-stroke", panel ? "" : "z-10 shrink-0")}
        >
          <div
            className={cn("mx-auto flex w-full max-w-5xl flex-col", panel ? "gap-2 px-4 pt-4" : "gap-2.5 px-8 pt-5", isPr ? "" : panel ? "pb-4" : "pb-5")}
          >
            <header className={cn("flex flex-col", panel ? "gap-2" : "gap-2.5")}>
              {panel ? null : identityRow}
              <h1
                title={item.title}
                className={cn("line-clamp-2 font-semibold leading-tight text-content", panel ? "text-[18px]" : "text-[20px]")}
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
                      <Button variant="ghost" size="content"
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
                      </Button>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {onStart && item.kind !== "pr" ? (
                  <>
                    <Button
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
                        const next = chooseStartProject
                          ? { ...item, projectPath: startProject }
                          : item;
                        startMutation.mutate({ target: next, body: tracker ? details?.body : undefined });
                      }}
                      variant="primary" size="md" className={cn("disabled:cursor-default disabled:opacity-40")}
                    >
                      {starting ? uiT("Sending...") : uiT("Send to agent")}
                    </Button>
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
                  <Button
                    type="button"
                    onClick={onDiscuss}
                    variant="secondary" size="md"
                  >
                    <MessageSquare className="size-3.5" />{" "}
                    {uiT("Ask")}
                  </Button>
                ) : null}
                {panel ? null : (
                  <Button
                    type="button"
                    title={
                      item.url ? externalActionLabel : uiT("No link available")
                    }
                    disabled={!item.url}
                    onClick={() => void openUrl(item.url)}
                    variant="ghost" size="md" className={cn("disabled:opacity-40")}
                  >
                    <ExternalLink className="size-3.5" />
                    {externalActionLabel}
                  </Button>
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
                    <Button variant="ghost" size="content"
                      type="button"
                      aria-pressed={diffMode === "hunks"}
                      onClick={() => setDiffMode("hunks")}
                      className={cn("rounded px-2.5 py-1 text-[11px] leading-none", diffMode === "hunks"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70")}
                    >
                      {uiT("Hunks")}
                    </Button>
                    <Button variant="ghost" size="content"
                      type="button"
                      aria-pressed={diffMode === "full"}
                      onClick={() => setDiffMode("full")}
                      className={cn("rounded px-2.5 py-1 text-[11px] leading-none", diffMode === "full"
                          ? "bg-selection text-content"
                          : "text-content/45 hover:text-content/70")}
                    >
                      {uiT("Full file")}
                    </Button>
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
            className={cn("mx-auto flex w-full max-w-5xl flex-col", panel ? "gap-6 px-4 py-5" : "gap-5 px-8 py-5")}
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
                  <Spinner className="size-4" />
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
                <Spinner className="size-4" />
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
                    commentMutation.reset();
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
    <Button variant="ghost" size="content"
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
    </Button>
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
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
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
