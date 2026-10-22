import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useId, useLayoutEffect, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import {
  Check,
  ChevronRight,
  Folder,
  FolderTree,
  GitBranch,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import type { MobileBranches, MobileWorktrees } from "./client";

/**
 * Where a new conversation works. "worktree" creates one on the first send;
 * "current" uses the project folder, or `cwd` when an existing worktree is chosen.
 */
export type MobileWorkspace = {
  mode: "current" | "worktree";
  /** Base ref for the new worktree; the current branch until one is chosen. */
  base?: string;
  /** Explicit execution directory selected from Git's registered working copies. */
  cwd?: string;
  /** Git's isMain flag determines membership, independently of cwd. */
  linkedWorktree?: boolean;
};

export const CURRENT_WORKSPACE: MobileWorkspace = { mode: "current" };

function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** The capsule label; translated by the caller. */
export function workspaceLabel(workspace: MobileWorkspace, creating = false):
  { key: string } | { text: string } {
  if (creating) return { key: "Creating worktree…" };
  if (workspace.mode === "worktree") return { key: "New worktree" };
  return workspace.cwd ? { text: folderName(workspace.cwd) } : { key: "Current checkout" };
}

type Load<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed" };

/** Reloads on each opening so new branches and worktrees appear. */
function useSheetLoad<T>(open: boolean, enabled: boolean, load: () => Promise<T>) {
  // The parent keys this surface by project; inline loader identities may vary.
  const scope = useId();
  const query = useQuery({ queryKey: ["mobile", "workspace", scope], queryFn: load, enabled: open && enabled, gcTime: 0 }, queryClient);
  const result: Load<T> = query.isError ? { state: "failed" } : query.data !== undefined ? { state: "ready", value: query.data } : { state: "loading" };
  return [result, () => { void query.refetch(); }] as const;
}

export function MobileWorkspaceControls({
  open,
  anchor,
  preserveFocus,
  workspace,
  disabled,
  loadBranches,
  loadWorktrees,
  onChange,
  onClose,
}: {
  open: boolean;
  anchor?: RefObject<HTMLElement | null>;
  preserveFocus?: RefObject<HTMLElement | null>;
  workspace: MobileWorkspace;
  disabled: boolean;
  loadBranches: () => Promise<MobileBranches>;
  loadWorktrees: () => Promise<MobileWorktrees>;
  onChange: (workspace: MobileWorkspace) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<"overview" | "base" | "worktrees">("overview");
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    if (open) {
      setPage("overview");
      setQuery("");
    }
  }, [open]);
  const [branches, retryBranches] = useSheetLoad(open, true, loadBranches);
  const [worktrees, retryWorktrees] = useSheetLoad(open, page === "worktrees", loadWorktrees);
  const current = branches.state === "ready" ? branches.value.current : null;
  const base = workspace.base ?? current ?? "HEAD";
  const spinner = <MobileSpinner size={20} className="mobile-spin" role="status" aria-label={t("Loading…")} />;
  const failure = (text: string, retry: () => void) => (
    <div className="mobile-workspace-status">
      <p className="mobile-form-error" role="alert">{t(text)}</p>
      <Button variant="secondary" type="button" onClick={retry}>{t("Retry")}</Button>
    </div>
  );
  const filter = query.trim().toLowerCase();
  const matches = (name: string) => !filter || name.toLowerCase().includes(filter);
  return (
    <MobileSheet
      open={open}
      placement={anchor ? "anchor" : "bottom"}
      anchor={anchor}
      preserveFocus={preserveFocus}
      width={SHEET_WIDTH.list}
      title={
        page === "base"
          ? "Worktree base branch"
          : page === "worktrees"
            ? "Existing worktree…"
            : "Workspace"
      }
      onClose={onClose}
      onBack={page === "overview" ? undefined : () => setPage("overview")}
    >
      {() =>
        page === "overview" ? (
          <div className="mobile-model-options">
            <div role="radiogroup" aria-label={t("Workspace")}>
              <button
                type="button"
                role="radio"
                className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                aria-checked={workspace.mode === "current" && !workspace.cwd}
                disabled={disabled}
                onClick={() => {
                  onChange({ mode: "current" });
                  onClose();
                }}
              >
                <Folder />
                <span className="mobile-sheet-row-text">
                  <strong>{t("Current checkout")}</strong>
                  {current && <small>{current}</small>}
                </span>
                {workspace.mode === "current" && !workspace.cwd && <Check />}
              </button>
              <button
                type="button"
                role="radio"
                className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                aria-checked={workspace.mode === "worktree"}
                disabled={disabled}
                onClick={() => onChange({ mode: "worktree", base: workspace.base ?? current ?? undefined })}
              >
                <FolderTree />
                <span className="mobile-sheet-row-text">
                  <strong>{t("New worktree")}</strong>
                  <small>{t("From {value0}", { value0: base })}</small>
                </span>
                {workspace.mode === "worktree" && <Check />}
              </button>
              <button
                type="button"
                role="radio"
                className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                aria-checked={!!workspace.cwd}
                disabled={disabled}
                onClick={() => setPage("worktrees")}
              >
                <FolderTree />
                <span className="mobile-sheet-row-text">
                  <strong>{t("Existing worktree…")}</strong>
                  {workspace.cwd && <small>{folderName(workspace.cwd)}</small>}
                </span>
                <ChevronRight />
              </button>
            </div>
            {workspace.mode === "worktree" && <>
              <div className="mobile-menu-divider" role="separator" />
              <button
                type="button"
                className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                disabled={disabled || branches.state === "failed"}
                aria-busy={branches.state === "loading" || undefined}
                onClick={() => setPage("base")}
              >
                <GitBranch />
                <span className="mobile-sheet-row-text mobile-sheet-row-inline">
                  <strong>{t("Branches")}</strong>
                  <small>{base}</small>
                </span>
                {branches.state === "loading" ? spinner : <ChevronRight />}
              </button>
              {branches.state === "failed" && failure("Could not load branches.", retryBranches)}
            </>}
          </div>
        ) : page === "base" ? (
          <div className="mobile-model-options mobile-workspace-branches">
            <input data-ui="input"
              type="search"
              aria-label={t("Search branches…")}
              placeholder={t("Search branches…")}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {branches.state === "loading" ? (
              <p className="mobile-muted" role="status">{t("Loading branches…")}</p>
            ) : branches.state === "failed" ? (
              failure("Could not load branches.", retryBranches)
            ) : (() => {
              const local = branches.value.branches.filter(matches);
              const remote = branches.value.remotes
                .map(({ remote, name }) => `${remote}/${name}`)
                .filter(matches);
              if (!local.length && !remote.length)
                return <p className="mobile-muted" role="status">{t("No matching branches")}</p>;
              const row = (name: string) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                  aria-checked={base === name}
                  disabled={disabled}
                  onClick={() => {
                    onChange({ mode: "worktree", base: name });
                    setPage("overview");
                  }}
                >
                  <span className="mobile-sheet-row-text">
                    <strong>{name}</strong>
                  </span>
                  {base === name && <Check />}
                </button>
              );
              return (
                <div role="radiogroup" aria-label={t("Worktree base branch")}>
                  {local.length > 0 && (
                    <div className="mobile-sheet-group" role="group" aria-label={t("Branches")}>
                      {remote.length > 0 && <h3>{t("Branches")}</h3>}
                      {local.map(row)}
                    </div>
                  )}
                  {remote.length > 0 && (
                    <div className="mobile-sheet-group" role="group" aria-label={t("Remote branches")}>
                      <h3>{t("Remote branches")}</h3>
                      {remote.map(row)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="mobile-model-options">
            {worktrees.state === "loading" ? (
              <p className="mobile-muted" role="status">{t("Loading worktrees…")}</p>
            ) : worktrees.state === "failed" ? (
              failure("Could not load worktrees.", retryWorktrees)
            ) : (() => {
              const linked = worktrees.value.worktrees.filter((tree) => !tree.isMain && !tree.missing);
              if (!linked.length)
                return <p className="mobile-muted" role="status">{t("No other worktrees")}</p>;
              return (
                <div role="radiogroup" aria-label={t("Worktrees")}>
                  {linked.map((tree) => (
                    <button
                      key={tree.path}
                      type="button"
                      role="radio"
                      className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                      aria-checked={workspace.cwd === tree.path}
                      disabled={disabled}
                      title={tree.path}
                      onClick={() => {
                        onChange({ mode: "current", cwd: tree.path, linkedWorktree: !tree.isMain });
                        onClose();
                      }}
                    >
                      <FolderTree />
                      <span className="mobile-sheet-row-text">
                        <strong>{folderName(tree.path)}</strong>
                        <small>
                          {tree.branch ?? t("Detached {value0}", { value0: tree.head.slice(0, 7) })}
                        </small>
                      </span>
                      {workspace.cwd === tree.path && <Check />}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )
      }
    </MobileSheet>
  );
}
