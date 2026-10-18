import { MenuHover } from "../../../shared/ui/MenuHover";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  ChevronDown,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
} from "../../../shared/ui/icons";
import { useRef, useState } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { githubPrAction, type GithubPrAction, type InboxItem } from "../model/githubTasks";
import { ACTION_OUTLINE } from "./inboxActions";



type GithubPrMergeAction = Extract<
  GithubPrAction,
  "merge" | "squash" | "rebase"
>;

const GITHUB_PR_MERGE_OPTIONS: Array<{
  action: GithubPrMergeAction;
  label: string;
  description: string;
}> = [
  {
    action: "merge",
    label: "Create a merge commit",
    description: "Add every commit to the base branch.",
  },
  {
    action: "squash",
    label: "Squash and merge",
    description: "Combine the commits into one.",
  },
  {
    action: "rebase",
    label: "Rebase and merge",
    description: "Add the commits without a merge commit.",
  },
];

const PR_ACTION_PRESS =
  "transition-transform duration-[120ms] ease-[var(--motion-ease-out)] active:scale-[0.97] motion-reduce:transition-none";

function githubPrActionCopy(
  action: GithubPrAction,
  baseRef: string,
  headRef: string,
): { title: string; detail: string; confirm: string; progress: string } {
  const source = headRef ? `“${headRef}”` : "this branch";
  const destination = baseRef ? `“${baseRef}”` : "the base branch";
  switch (action) {
    case "merge":
      return {
        title: "Merge this pull request?",
        detail: `Every commit from ${source} will be added to ${destination} with a merge commit.`,
        confirm: "Merge pull request",
        progress: "Merging…",
      };
    case "squash":
      return {
        title: "Squash and merge?",
        detail: `The commits from ${source} will be combined into one commit on ${destination}.`,
        confirm: "Squash and merge",
        progress: "Merging…",
      };
    case "rebase":
      return {
        title: "Rebase and merge?",
        detail: `The commits from ${source} will be rebased individually onto ${destination}.`,
        confirm: "Rebase and merge",
        progress: "Merging…",
      };
    case "draft":
      return {
        title: "Convert to draft?",
        detail:
          "Reviewers will see that this pull request is not ready to merge.",
        confirm: "Convert to draft",
        progress: "Converting…",
      };
    case "ready":
      return {
        title: "Mark as ready for review?",
        detail:
          "Reviewers will see that this pull request is ready for feedback.",
        confirm: "Ready for review",
        progress: "Updating…",
      };
    case "close":
      return {
        title: "Close this pull request?",
        detail:
          "The pull request will close without merging. You can reopen it later.",
        confirm: "Close pull request",
        progress: "Closing…",
      };
    case "reopen":
      return {
        title: "Reopen this pull request?",
        detail: "The pull request will return to the open state.",
        confirm: "Reopen pull request",
        progress: "Reopening…",
      };
  }
}

export function GithubPrActions({
  item,
  baseRef,
  headRef,
  onChange,
}: {
  item: InboxItem;
  baseRef: string;
  headRef: string;
  onChange?: (item: InboxItem) => void;
}) {
  const { t: uiT } = useTranslation();
  const mergeGroup = useRef<HTMLDivElement>(null);
  const [mergeAction, setMergeAction] = useState<GithubPrMergeAction>("merge");
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: GithubPrAction;
    anchor: HTMLElement;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const state = item.state.trim().toLowerCase();
  const selectedMerge =
    GITHUB_PR_MERGE_OPTIONS.find((option) => option.action === mergeAction) ??
    GITHUB_PR_MERGE_OPTIONS[0];

  const askToRun = (action: GithubPrAction, anchor: HTMLElement) => {
    setMergeMenuOpen(false);
    setActionError(null);
    setNotice(null);
    setConfirmation({ action, anchor });
  };

  const dismissConfirmation = () => {
    if (busy) return;
    setConfirmation(null);
    setActionError(null);
  };

  const runAction = async () => {
    if (!confirmation || busy) return;
    const action = confirmation.action;
    setBusy(true);
    setActionError(null);
    try {
      const next = await githubPrAction(
        item.projectPath,
        item.repo,
        item.number,
        action,
      );
      setConfirmation(null);
      setNotice(
        (action === "merge" || action === "squash" || action === "rebase") &&
          next.state.trim().toLowerCase() !== "merged"
          ? "Merge queued or auto-merge enabled."
          : null,
      );
      onChange?.({
        ...item,
        ...next,
        projectPath: item.projectPath,
        provider: "github",
      });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = confirmation
    ? githubPrActionCopy(confirmation.action, baseRef, headRef)
    : null;
  const stateButton = `${ACTION_OUTLINE} ${PR_ACTION_PRESS} disabled:cursor-default disabled:opacity-40`;

  return (
    <>
      {state === "open" && !item.draft ? (
        <div
          ref={mergeGroup}
          role="group"
          aria-label={uiT("Merge pull request")}
          className="inline-flex h-7 overflow-hidden rounded-md bg-content text-background-base"
        >
          <button
            type="button"
            disabled={busy}
            onClick={(event) => askToRun(mergeAction, event.currentTarget)}
            className={`inline-flex items-center gap-1.5 px-3 text-[12px] font-medium hover:bg-background-base/10 disabled:cursor-default disabled:opacity-40 ${PR_ACTION_PRESS}`}
          >
            <GitMerge className="size-3.5" />
            {selectedMerge?.action === "merge"
              ? uiT("Merge pull request")
              : selectedMerge
                ? uiT(selectedMerge.label)
                : undefined}
          </button>
          <button
            type="button"
            title={uiT("Merge options")}
            aria-label={uiT("Merge options")}
            aria-haspopup="menu"
            aria-expanded={mergeMenuOpen}
            disabled={busy}
            onClick={() => setMergeMenuOpen((open) => !open)}
            className={`grid w-7 place-items-center border-l border-background-base/20 hover:bg-background-base/10 disabled:cursor-default disabled:opacity-40 ${PR_ACTION_PRESS}`}
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      ) : null}
      {state === "open" && item.draft ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("ready", event.currentTarget)}
          className={stateButton}
        >
          <GitPullRequest className="size-3.5" />
          {uiT("Ready for review")}
        </button>
      ) : null}
      {state === "open" && !item.draft ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("draft", event.currentTarget)}
          className={stateButton}
        >
          <GitPullRequestDraft className="size-3.5" />
          {uiT("Convert to draft")}
        </button>
      ) : null}
      {state === "open" ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("close", event.currentTarget)}
          className={`${stateButton} hover:text-rose-400`}
        >
          <GitPullRequestClosed className="size-3.5" />
          {uiT("Close pull request")}
        </button>
      ) : null}
      {state === "closed" ? (
        <button
          type="button"
          disabled={busy}
          onClick={(event) => askToRun("reopen", event.currentTarget)}
          className={stateButton}
        >
          <GitPullRequest className="size-3.5" />
          {uiT("Reopen pull request")}
        </button>
      ) : null}
      {notice ? (
        <span role="status" className="text-[11px] text-content/55">
          {notice}
        </span>
      ) : null}
      <PresenceBoundary propagate>{mergeMenuOpen && state === "open" && !item.draft ? (
        <Popover
          anchor={mergeGroup}
          gap={4}
          width={260}
          autoFocus
          onDismiss={() => setMergeMenuOpen(false)}
          role="menu"
          tabIndex={-1}
          aria-label={uiT("Merge method")}
          className="p-1"
        >
          {GITHUB_PR_MERGE_OPTIONS.map((option) => (
            <button
              key={option.action}
              type="button"
              role="menuitemradio"
              aria-checked={option.action === mergeAction}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setMergeAction(option.action);
                setMergeMenuOpen(false);
              }}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-content/5 ${
                option.action === mergeAction
                  ? "bg-selection text-content"
                  : "text-content/75"
              }`}
            >
              <MenuHover />
              <span
                aria-hidden
                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                  option.action === mergeAction
                    ? "bg-emerald-400"
                    : "bg-content/20"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium leading-tight">
                  {uiT(option.label)}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-content/45">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </Popover>
      ) : null}</PresenceBoundary>
      <PresenceBoundary propagate>{confirmation && confirmCopy ? (
        <Popover
          anchor={confirmation.anchor}
          gap={5}
          width={320}
          autoFocus
          onDismiss={busy ? undefined : dismissConfirmation}
          role="dialog"
          tabIndex={-1}
          aria-label={confirmCopy.title}
          className="p-3"
        >
          <div className="flex flex-col gap-1">
            <h2 className="desktop-pane-heading text-[13px] font-medium text-content">
              {confirmCopy.title}
            </h2>
            <p className="text-[12px] leading-snug text-content/55">
              {confirmCopy.detail}
            </p>
          </div>
          {actionError ? (
            <p
              role="alert"
              className="mt-2 break-words text-[11px] leading-snug text-rose-400"
            >
              {actionError}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={dismissConfirmation}
              className={`h-7 rounded-md px-3 text-[12px] text-content/65 hover:bg-content/5 hover:text-content disabled:cursor-default disabled:opacity-40 ${PR_ACTION_PRESS}`}
            >
              {uiT("Cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction()}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium disabled:cursor-default disabled:opacity-60 ${
                confirmation.action === "close"
                  ? "bg-rose-500/20 text-rose-700 hover:bg-rose-500/30 dark:text-rose-300"
                  : confirmation.action === "merge" ||
                      confirmation.action === "squash" ||
                      confirmation.action === "rebase"
                    ? "bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-300"
                    : "bg-content text-background-base hover:bg-content/80"
              } ${PR_ACTION_PRESS}`}
            >
              {busy ? (
                <LoaderCircle
                  className="size-3.5 animate-spin"
                />
              ) : null}
              {busy ? confirmCopy.progress : confirmCopy.confirm}
            </button>
          </div>
        </Popover>
      ) : null}</PresenceBoundary>
    </>
  );
}
