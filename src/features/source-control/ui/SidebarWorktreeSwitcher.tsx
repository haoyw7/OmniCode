import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useWorktreeFocus, type WorktreeFocus } from "../model/worktreeFocus";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { basename } from "../../../platform/tauri/fs";
import { Popover } from "../../../shared/ui/Popover";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  FolderTree,
  GitBranch,
  Loader,
} from "../../../shared/ui/icons";

/** Picking a worktree narrows the sidebar and new sessions to that working copy. */
export function SidebarWorktreeSwitcher({
  cwd,
  tabStats,
  onSelect,
  pending = false,
  switchError,
  compact = false,
  iconOnly = false,
}: {
  cwd: string;
  onSelect?: (focus?: WorktreeFocus) => void;
  pending?: boolean;
  switchError?: string;
  /** Show the branch beside a separate project picker in the sidebar header. */
  compact?: boolean;
  /** A separate branch picker already labels the current working copy. */
  iconOnly?: boolean;
  /** Open tabs per worktree path key; hidden worktrees can still hold some. */
  tabStats?: ReadonlyMap<string, { tabs: number; busy: boolean }>;
}) {
  const { t: uiT } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const focus = useWorktreeFocus(cwd);
  const { branches, settled } = useProjectBranchesState(cwd, true);
  // Empty Git metadata is a plain folder. A failed metadata lookup still
  // permits the worktree query so its error can be shown.
  const canListWorktrees =
    Boolean(branches?.current || branches?.branches.length) ||
    (settled && branches === null);
  const { data, error, refresh } = useProjectWorktrees(cwd, canListWorktrees);
  // The project folder is the default, unfocused entry; missing worktrees
  // cannot be opened, so they are left out.
  const main = data?.worktrees.find((tree) => tree.isMain);
  const worktrees =
    data?.worktrees.filter((tree) => !tree.isMain && !tree.missing) ?? [];

  // A deleted worktree cannot stay focused, or new sessions would start there.
  useEffect(() => {
    if (
      focus &&
      !pending &&
      !switchError &&
      data &&
      !data.worktrees.some(
        (tree) =>
          !tree.isMain &&
          !tree.missing &&
          pathKey(tree.path) === pathKey(focus.path),
      )
    )
      onSelect?.(undefined);
  }, [cwd, data, focus, onSelect, pending, switchError]);

  useEffect(() => {
    if (switchError) setOpen(true);
  }, [switchError]);

  const title = basename(cwd);
  if (
    (!canListWorktrees ||
      ((!compact || iconOnly) && data && worktrees.length === 0)) &&
    !focus &&
    !switchError &&
    !pending
  )
    return compact || iconOnly ? null : (
      <span className="min-w-0 truncate text-sm font-medium leading-tight">
        {title}
      </span>
    );

  const focusedTree = focus
    ? data?.worktrees.find((tree) => pathKey(tree.path) === pathKey(focus.path))
    : undefined;
  const branchLabel = focus
    ? (focus.branch ??
      focusedTree?.branch ??
      (focusedTree?.head
        ? uiT("Detached {value0}", { value0: focusedTree.head.slice(0, 7) })
        : uiT("Detached worktree")))
    : (main?.branch ??
      branches?.current ??
      (main?.head
        ? uiT("Detached {value0}", { value0: main.head.slice(0, 7) })
        : uiT("Project folder")));

  const row = (
    key: string,
    selected: boolean,
    icon: ReactNode,
    label: string,
    detail: string,
    onPick: () => void,
    path: string,
  ) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => {
        onPick();
        setOpen(false);
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-content/3"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]">{label}</span>
        <span className="block truncate text-[10px] text-content/40">
          {detail}
        </span>
      </span>
      <OpenTabs stats={tabStats?.get(pathKey(path))} />
      {selected ? <Check className="size-3.5 shrink-0" /> : null}
    </button>
  );

  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-tauri-drag-region="false"
        aria-label={uiT("Switch working copy")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={pending}
        title={
          focus
            ? `${compact ? branchLabel : (focus.branch ?? "detached")}\n${prettyCwd(focus.path)}`
            : compact
              ? branchLabel
              : (main?.branch ?? uiT("Project folder"))
        }
        onClick={() => {
          if (!open) void refresh();
          setOpen(!open);
        }}
        className={`flex min-w-0 max-w-full items-center rounded-md leading-tight hover:bg-content/5 aria-expanded:bg-content/8 ${iconOnly ? "size-6 shrink-0 justify-center text-content/60 hover:text-content" : compact ? "h-8 gap-1.5 px-1.5 text-[12px] text-content/60 hover:text-content" : "-ml-1.5 h-6.5 gap-2 px-1.5 text-sm font-medium"}`}
      >
        {iconOnly ? (
          !pending ? (
            <FolderTree className="size-3.5 shrink-0" />
          ) : null
        ) : (
          <>
            {compact ? <GitBranch className="size-3.5 shrink-0" /> : null}
            <span className="min-w-0 truncate">
              {compact ? branchLabel : title}
            </span>
          </>
        )}
        {pending ? (
          <Loader
            aria-label={uiT("Switching working copy")}
            className="size-3.5 shrink-0 animate-spin text-content/45"
          />
        ) : iconOnly ? null : compact ? (
          <ChevronDown className="size-3 shrink-0 text-content/45" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-content/45" />
        )}
      </button>
      <Popover
        open={open}
        anchor={anchor}
        side="bottom"
        align="start"
        width={280}
        maxHeight={360}
        onDismiss={() => setOpen(false)}
        role="listbox"
        aria-label={uiT("Working copies")}
        className="overflow-y-auto p-1"
      >
        {row(
          "default",
          !focus,
          <GitBranch className="size-3.5 shrink-0 text-content/50" />,
          main?.branch ?? "Project folder",
          "Project folder · all sessions",
          () => onSelect?.(undefined),
          main?.path ?? cwd,
        )}
        {!data && !error && (canListWorktrees || !settled) ? (
          <div className="flex items-center gap-2 p-2 text-[12px] text-content/50">
            <Loader className="size-3.5 animate-spin" />
            {uiT("Loading working copies…")}
          </div>
        ) : null}
        {worktrees.map((tree) =>
          row(
            tree.path,
            !!focus && pathKey(focus.path) === pathKey(tree.path),
            <FolderTree className="size-3.5 shrink-0 text-content/50" />,
            tree.branch ?? `Detached ${tree.head.slice(0, 7)}`,
            prettyCwd(tree.path),
            () => onSelect?.({ path: tree.path, branch: tree.branch }),
            tree.path,
          ),
        )}
        {switchError || error ? (
          <p role="alert" className="px-2 py-2 text-[11px] text-red-400">
            {switchError || error}
          </p>
        ) : null}
      </Popover>
    </>
  );
}

/** Tabs a worktree keeps open while another one is shown. */
function OpenTabs({ stats }: { stats?: { tabs: number; busy: boolean } }) {
  if (!stats?.tabs) return null;
  const label = `${stats.tabs} open tab${stats.tabs === 1 ? "" : "s"}${stats.busy ? ", working" : ""}`;
  return (
    <span
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-content/40"
    >
      {stats.busy ? (
        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
      ) : null}
      {stats.tabs}
    </span>
  );
}
