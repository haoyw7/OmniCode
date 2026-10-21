import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useIsPresent } from "motion/react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { cloneElement, useEffect, useRef, useState, type ReactElement, type Ref } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { isEqualOrInside, pathKey, prettyCwd } from "../../../shared/lib/paths";
import { NO_BRANCH_LABEL, registeredWorktreeAt, type Worktree } from "../model/worktrees";
import { BranchPicker } from "./BranchPicker";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { GitPickerTrigger } from "./GitPickerTrigger";
import { Popover } from "../../../shared/ui/Popover";
import {
  Check,
  FolderTree,
  GitBranch,
  Plus,
  Search,
  Settings,
} from "../../../shared/ui/icons";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

export function WorktreePicker({
  cwd,
  executionCwd,
  enabled = true,
  opensNewSession = false,
  worktreeRemoved = false,
  onSelect,
  onBranchChange,
  onManage,
  onClose,
}: {
  cwd: string;
  executionCwd: string;
  enabled?: boolean;
  opensNewSession?: boolean;
  worktreeRemoved?: boolean;
  onSelect: (tree: Worktree) => Promise<void>;
  onBranchChange?: () => void;
  onManage?: () => void;
  onClose?: () => void;
}) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const [branchPicker, setBranchPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const mutation = useMutation({ mutationFn: (tree: Worktree) => onSelect(tree) }, queryClient);
  const busy = mutation.isPending;
  const error = mutation.error ? String(mutation.error) : undefined;
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const { branches, settled } = useProjectBranchesState(
    worktreeRemoved ? cwd : executionCwd,
    !!cwd && cwd !== "~",
  );
  const {
    data,
    error: loadError,
    refresh,
  } = useProjectWorktrees(
    cwd,
    enabled,
  );
  const selectedTree = registeredWorktreeAt(executionCwd, data?.worktrees ?? []);
  const inWorktree = !!selectedTree && !selectedTree.isMain;
  const missingWorktree = data?.worktrees.some((tree) => !tree.isMain && tree.missing && isEqualOrInside(executionCwd, tree.path));
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setCreating(false);
      setBranchPicker(false);
    }
  }, [enabled]);
  const dismiss = () => {
    setOpen(false);
    setQuery("");
    setActivePath(undefined);
    onClose?.();
  };
  const select = async (tree: Worktree) => {
    if (busy || tree.missing) return;
    try {
      await mutation.mutateAsync(tree);
      dismiss();
    } catch { /* The query mutation retains its error. */ }
  };
  const rows =
    data?.worktrees.filter((tree) =>
      `${tree.branch ?? "detached"} ${tree.path}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  // Default to the current working copy, including when rows arrive after open.
  // Track navigation by path so background refreshes cannot move the highlight.
  const active = Math.max(
    0,
    rows.findIndex(
      (tree) => pathKey(tree.path) === pathKey(activePath ?? executionCwd),
    ),
  );
  const activeRowPath = rows[active]?.path;
  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, active, activeRowPath]);
  return <>
    <PresenceBoundary>{branchPicker ? (
      <BranchPicker
        cwd={executionCwd}
        enabled={enabled}
        worktree={inWorktree}
        initialOpen
        onDismiss={() => setBranchPicker(false)}
        onChange={onBranchChange}
        onClose={() => {
          setBranchPicker(false);
          onClose?.();
        }}
      />
    ) : null}</PresenceBoundary>
    <PresenceBoundary>{!branchPicker ? (
    <WorkingCopyPresence>
    <div ref={anchor} className="relative flex min-w-0 shrink">
      <GitPickerTrigger
        disabled={
          !enabled || (!worktreeRemoved && !missingWorktree && !branches?.current && !inWorktree)
        }
        title={
          worktreeRemoved
            ? uiT("Select a branch or worktree to continue this session")
            : uiT("Working copy: {value0}", {
                value0: String(prettyCwd(executionCwd)),
              })
        }
        aria-label={uiT("Choose working copy")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          mutation.reset();
          setQuery("");
          setActivePath(undefined);
          if (!open) refresh();
          setOpen(!open);
        }}
        label={
          worktreeRemoved
            ? NO_BRANCH_LABEL
            : branches?.current
              ? branches.detached
                ? uiT("detached {value0}", { value0: String(branches.current) })
                : branches.current
              : settled
                ? inWorktree || missingWorktree
                  ? uiT("Worktree unavailable")
                  : uiT("No repo")
                : uiT("Loading…")
        }
        worktree={!worktreeRemoved && inWorktree}
      />
      <PresenceBoundary propagate>{open && (
        <Popover
          anchor={anchor}
          side="top"
          width={320}
          maxHeight={400}
          onDismiss={() => {
            if (!busy) dismiss();
          }}
          role="dialog"
          aria-label={uiT("Working copies")}
          data-branch-picker
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-2">
            <Search className="size-3.5 text-content/40" />
            <Input variant="inline"
              ref={search}
              aria-label={uiT("Search working copies")}
              placeholder={uiT("Search working copies…")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActivePath(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      active + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
                  setActivePath(rows[next]?.path);
                }
                if (e.key === "Enter" && rows[active]) {
                  e.preventDefault();
                  void select(rows[active]);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
            />
          </label>
          {worktreeRemoved && (
            <p className="shrink-0 px-3 pt-2 pb-1 text-[11px] text-content/50">
              {uiT(
                "This session’s worktree was deleted. Select a working copy to continue.",
              )}
            </p>
          )}
          {opensNewSession && !worktreeRemoved && (
            <p className="shrink-0 px-3 pt-2 pb-1 text-[11px] text-content/50">
              {uiT("Another working copy opens a new session.")}
            </p>
          )}
          <div
            className="min-h-0 overflow-y-auto p-1"
            role="listbox"
            aria-label={uiT("Working copies")}
          >
            {!data && !loadError && (
              <div className="flex items-center gap-2 p-2 text-[12px] text-content/50">
                <Spinner className="size-3.5" />
                {uiT("Loading working copies…")}
              </div>
            )}
            {rows.map((tree, index) => (
              <Button data-menu-row="description" variant="ghost" size="content"
                key={tree.path}
                ref={index === active ? activeOption : undefined}
                type="button"
                role="option"
                aria-selected={
                  !worktreeRemoved &&
                  pathKey(tree.path) === pathKey(executionCwd)
                }
                disabled={busy || tree.missing}
                onMouseEnter={() => setActivePath(tree.path)}
                onClick={() => void select(tree)}
                title={tree.path}
                className={cn("flex w-full items-center gap-2 rounded-md text-left disabled:opacity-40 justify-start", active === index ? "bg-selection" : "hover:bg-content/3")}
              >
                {tree.isMain ? (
                  <GitBranch className="size-3.5 shrink-0 text-content/50" />
                ) : (
                  <FolderTree className="size-3.5 shrink-0 text-content/50" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">
                    {tree.branch ??
                      uiT("Detached {value0}", {
                        value0: String(tree.head.slice(0, 7)),
                      })}
                  </span>
                  <span className="block truncate text-[10px] text-content/40">
                    {tree.isMain ? uiT("Project folder") : prettyCwd(tree.path)}
                    {tree.missing ? uiT(" · Missing") : ""}
                  </span>
                </span>
                {!worktreeRemoved &&
                  pathKey(tree.path) === pathKey(executionCwd) && (
                    <Check className="size-3.5" />
                  )}
              </Button>
            ))}
            {data && !rows.length && (
              <p className="p-2 text-[12px] text-content/45">
                {uiT("No matching working copies")}
              </p>
            )}
            {(error || loadError) && (
              <p role="alert" className="px-2 py-2 text-[11px] text-red-400">
                {error || loadError}
              </p>
            )}
          </div>
          <div className="shrink-0 border-t border-stroke p-1 text-[12px]">
            <Button data-menu-row="single" variant="ghost" size="content"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2 rounded-md text-left hover:bg-content/5 justify-start"
            >
              <Plus className="size-3.5" />
              {uiT("Create worktree…")}
            </Button>
            <Button data-menu-row="single" variant="ghost" size="content"
              type="button"
              disabled={busy || worktreeRemoved}
              onClick={() => {
                setOpen(false);
                setBranchPicker(true);
              }}
              className="flex w-full items-center gap-2 rounded-md text-left text-content/55 hover:bg-content/5 disabled:opacity-40 justify-start"
            >
              <GitBranch className="size-3.5" />
              {uiT("Switch branch in this working copy…")}
            </Button>
            {onManage && (
              <Button data-menu-row="single" variant="ghost" size="content"
                type="button"
                disabled={busy}
                onClick={() => {
                  dismiss();
                  onManage();
                }}
                className="flex w-full items-center gap-2 rounded-md text-left text-content/55 hover:bg-content/5 justify-start"
              >
                <Settings className="size-3.5" />
                {uiT("Manage worktrees…")}
              </Button>
            )}
          </div>
        </Popover>
      )}</PresenceBoundary>
      <PresenceBoundary>{creating && (
        <CreateWorktreeDialog
          cwd={cwd}
          baseCwd={worktreeRemoved ? cwd : executionCwd}
          defaultRoot={data?.defaultRoot}
          onCreated={async (tree) => {
            setCreating(false);
            setOpen(true);
            await select(tree);
          }}
          onCancel={() => {
            setCreating(false);
            onClose?.();
          }}
        />
      )}</PresenceBoundary>
    </div>
    </WorkingCopyPresence>
    ) : null}</PresenceBoundary>
  </>;
}

/** Hide the replaced trigger while its portal finishes leaving. */
function WorkingCopyPresence({ children }: { children: ReactElement<{ hidden?: boolean; inert?: boolean; ref?: Ref<HTMLDivElement> }> }) {
  const present = useIsPresent();
  const node = useRef<HTMLDivElement | null>(null);
  const forwarded = children.props.ref;
  return cloneElement(children, {
    hidden: !present,
    inert: !present,
    ref: (element: HTMLDivElement | null) => {
      const previous = node.current;
      node.current = element;
      if (typeof forwarded === "function") forwarded(element);
      else if (forwarded && (element || forwarded.current === previous)) forwarded.current = element;
    },
  });
}
