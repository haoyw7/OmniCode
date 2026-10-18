import type { PopoverAnchor } from "../../../shared/ui/Popover";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { useIsPresent } from "motion/react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Check, GitBranch, Plus, Search } from "../../../shared/ui/icons";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitStageAll,
  gitStash,
  isCheckoutBlockedByChanges,
  notifyGitChanged,
  type GitBranchInfo,
} from "../../../platform/tauri/fs";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { GitPickerTrigger } from "./GitPickerTrigger";
import { MenuPanel } from "../../../shared/ui/primitives/MenuPanel";
import { SwitchBranchDialog } from "./SwitchBranchDialog";
import { BranchMenuScrollArea, branchMenuLayout } from "./branchMenu";

type Props = {
  cwd: string;
  branch?: string;
  enabled?: boolean;
  worktree?: boolean;
  initialOpen?: boolean;
  onDismiss?: () => void;
  onChange?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  menuAnchor?: PopoverAnchor;
  popoverSide?: "top" | "bottom" | "right";
};

type CreateRow = { kind: "create"; name: string };
type BranchRow = { kind: "branch"; branch: GitBranchInfo };
type Row = CreateRow | BranchRow;

type PendingSwitch =
  | { kind: "create"; name: string }
  | { kind: "checkout"; name: string; remote: string | null };

const MENU_MIN_HEIGHT = 180;

export function BranchPicker({
  cwd,
  branch,
  enabled = true,
  worktree = false,
  initialOpen = false,
  onDismiss,
  onChange,
  onClose,
  onOpenChange,
  popoverSide = "top",
  menuAnchor,
}: Props) {
  const { t: uiT } = useTranslation();
  const menu = branchMenuLayout();
  const present = useIsPresent();
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocked, setBlocked] = useState<PendingSwitch | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [blockedBusy, setBlockedBusy] = useState<"stash" | "commit" | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const surfaceOpen = open || creating || blocked !== null;
  useEffect(() => {
    onOpenChange?.(surfaceOpen);
  }, [surfaceOpen, onOpenChange]);
  useEffect(() => () => { if (!menuAnchor) onOpenChange?.(false); }, [onOpenChange, menuAnchor]);

  const inProject = Boolean(cwd) && cwd !== "~";
  const { branches: projectBranches, settled: branchesSettled } =
    useProjectBranchesState(cwd, inProject);

  const current = branch || projectBranches?.current || null;
  const detached = !branch && !!projectBranches?.detached;

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setCreating(false);
    setQuery("");
    setError(null);
    setBusy(false);
    setBlocked(null);
    setBlockedError(null);
    setBlockedBusy(null);
    onDismiss?.();
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    if (!menu.desktop) setActive(0);
  }, [open, menu.desktop]);

  useEffect(() => {
    // Popover measures itself off-screen behind `visibility: hidden` before
    // placing it; focusing during that pass is a no-op in real browsers, so
    // wait a frame for the popover to actually be visible.
    if (!open) return;
    const id = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setCreating(false);
    setQuery("");
    setError(null);
    setBusy(false);
    setBlocked(null);
    setBlockedError(null);
    setBlockedBusy(null);
  }, [enabled]);

  const createName = query.trim();
  const createTaken = (projectBranches?.branches ?? []).some(
    (entry) => !entry.remote && entry.name === createName,
  );
  const createRow: CreateRow | null = createTaken
    ? null
    : { kind: "create", name: createName };

  const rows = useMemo((): BranchRow[] => {
    const branches = projectBranches?.branches ?? [];
    const name = query.trim();
    const needle = name.toLowerCase();
    const filtered = needle
      ? branches.filter((entry) => {
          const hay = entry.remote
            ? `${entry.name} ${entry.remote}`
            : entry.name;
          return hay.toLowerCase().includes(needle);
        })
      : branches;
    const selected = branch || projectBranches?.current;
    return filtered.map((entry) => ({
      kind: "branch" as const,
      branch: {
        ...entry,
        current: entry.name === selected && !entry.remote,
      },
    }));
  }, [branch, projectBranches, query]);

  useEffect(() => {
    if (menu.desktop && open) {
      setActive(
        query.trim()
          ? 0
          : Math.max(
              0,
              rows.findIndex((row) => row.branch.current),
            ),
      );
      return;
    }
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [menu.desktop, open, rows, query]);

  // Failures, including checkout blocked by local changes, stay in the picker or dialog.
  const applySwitch = (pending: PendingSwitch) =>
    withStatusToast(
      () =>
        pending.kind === "create"
          ? gitCreateBranch(cwd, pending.name)
          : gitCheckout(cwd, pending.name, pending.remote),
      {
        loading: uiT("Switching branch…"),
        success: uiT("Switched to {branch}", { branch: pending.name }),
        error: false,
      },
    );

  const finishSwitch = () => {
    notifyGitChanged();
    onChangeRef.current?.();
    dismiss(true);
  };

  const failMessage = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  const run = async (
    pending: PendingSwitch,
    source: "picker" | "dialog" = "picker",
  ) => {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await applySwitch(pending);
      finishSwitch();
    } catch (err) {
      const message = failMessage(err);
      if (isCheckoutBlockedByChanges(message)) {
        setOpen(false);
        setCreating(false);
        setQuery("");
        setError(null);
        setBusy(false);
        setBlockedError(null);
        setBlockedBusy(null);
        setBlocked(pending);
        return;
      }
      setError(message);
      setBusy(false);
      if (source === "picker") search.current?.focus();
    }
  };

  const resolveBlocked = async (
    kind: "stash" | "commit",
    work: () => Promise<unknown>,
  ) => {
    if (!blocked || blockedBusy) return;
    setBlockedBusy(kind);
    setBlockedError(null);
    try {
      await work();
      await applySwitch(blocked);
      finishSwitch();
    } catch (err) {
      setBlockedError(failMessage(err));
      setBlockedBusy(null);
    }
  };

  const pick = (row: Row) => {
    if (row.kind === "create") {
      if (!row.name) {
        setOpen(false);
        setQuery("");
        setError(null);
        setCreating(true);
        return;
      }
      void run({ kind: "create", name: row.name });
      return;
    }
    if (row.branch.current) {
      dismiss(true);
      return;
    }
    void run({
      kind: "checkout",
      name: row.branch.name,
      remote: row.branch.remote,
    });
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) {
        pick(row);
        return;
      }
      if (createName && createRow) pick(createRow);
    }
  };

  // Always keep the control mounted so the composer's toolbar does not resize
  // when a folder isn't a git repo. The loading skeleton, "No repo" label, and
  // real branch all share the same icon + 12px line box.
  const awaitingBranch = inProject && !current && !branchesSettled;
  const missingGit = !current && !awaitingBranch;
  const label = current
    ? detached
      ? `detached ${current}`
      : current
    : "No repo";
  const title = awaitingBranch
    ? "Loading branch…"
    : missingGit
      ? "No git repository"
      : label;
  const interactive = enabled && !awaitingBranch && !missingGit;
  const branchList = (
    <BranchList
      rows={rows}
      active={active}
      busy={busy}
      desktop={menu.desktop}
      emptyLabel={query.trim() ? "No matching branches" : "No branches"}
      onActive={setActive}
      onPick={pick}
    />
  );
  const createAction = createRow ? (
    <div
      data-create-blank={!createRow.name || undefined}
      className="branch-menu-create shrink-0 border-t border-stroke p-1 px-1.5"
    >
      <button
        type="button"
        disabled={busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(createRow)}
        className="flex h-7.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-content/75 hover:bg-content/5 hover:text-content disabled:opacity-60"
      >
        <Plus className="size-4 shrink-0" />
        <span className="min-w-0 truncate">
          {createRow.name
            ? uiT("Create and checkout {value0}", {
                value0: String(createRow.name),
              })
            : uiT("New branch")}
        </span>
      </button>
    </div>
  ) : null;

  return (
    <div
      ref={root}
      hidden={!present}
      inert={!present}
      className="relative flex min-w-0 shrink"
    >
      {!menuAnchor ? <GitPickerTrigger
        title={title}
        aria-label={
          awaitingBranch
            ? uiT("Loading branch")
            : missingGit
              ? uiT("No git repository")
              : uiT("Branch {value0}", { value0: String(label) })
        }
        aria-expanded={missingGit ? undefined : open}
        aria-haspopup={missingGit ? undefined : "dialog"}
        disabled={!interactive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!interactive || blocked) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        label={label}
        loading={awaitingBranch}
        worktree={worktree}
      /> : null}
      <PresenceBoundary>
        {blocked ? (
          <SwitchBranchDialog
            cwd={cwd}
            branch={blocked.name}
            creating={blocked.kind === "create"}
            busy={blockedBusy}
            error={blockedError}
            onStash={() => {
              void resolveBlocked("stash", () =>
                gitStash(cwd, `WIP before switching to ${blocked.name}`),
              );
            }}
            onCommit={(message) => {
              void resolveBlocked("commit", async () => {
                await gitStageAll(cwd);
                await gitCommit(cwd, message);
              });
            }}
            onCancel={() => {
              if (blockedBusy) return;
              setBlocked(null);
              setBlockedError(null);
              onCloseRef.current?.();
            }}
          />
        ) : null}
      </PresenceBoundary>
      <PresenceBoundary>
        {creating ? (
          <CreateBranchDialog
            busy={busy}
            error={error}
            onCreate={(name) => {
              void run({ kind: "create", name }, "dialog");
            }}
            onCancel={() => {
              if (busy) return;
              setCreating(false);
              setError(null);
              onCloseRef.current?.();
            }}
          />
        ) : null}
      </PresenceBoundary>
      <MenuPanel
        open={open}
        anchor={menuAnchor ?? root}
        submenu={!!menuAnchor}
        side={popoverSide}
        width={menu.width}
        minHeight={menu.desktop ? 0 : MENU_MIN_HEIGHT}
        maxHeight={menu.maxHeight}
        onDismiss={(reason) => dismiss(reason === "escape" && !menuAnchor)}
        role="dialog"
        aria-label={uiT("Branch picker")}
        data-branch-picker
        data-menu-density={menu.desktop ? "compact" : undefined}
        className="branch-menu flex flex-col overflow-hidden"
      >
        <label className="branch-menu-search flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-2.5 text-content/50">
          <Search className="size-3.5 shrink-0" />
          <input
            ref={search}
            type="text"
            value={query}
            placeholder={uiT(
              menu.desktop
                ? "Search branches…"
                : "Search or create a branch...",
            )}
            aria-label={uiT("Search or create a branch")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={busy}
            className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-content outline-none placeholder:text-content/40 disabled:opacity-60"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setError(null);
            }}
            onKeyDown={onSearchKey}
          />
        </label>
        {menu.desktop ? (
          <BranchMenuScrollArea>
            {branchList}
            {createAction}
          </BranchMenuScrollArea>
        ) : (
          branchList
        )}
        {error ? (
          <p className="max-h-16 shrink-0 overflow-y-auto whitespace-pre-wrap border-t border-stroke px-2.5 py-2 text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}
        {menu.desktop ? null : createAction}
      </MenuPanel>
    </div>
  );
}

function BranchList({
  rows,
  active,
  busy,
  desktop,
  emptyLabel,
  onActive,
  onPick,
}: {
  rows: BranchRow[];
  active: number;
  busy: boolean;
  desktop: boolean;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (row: BranchRow) => void;
}) {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointerHighlight = useRef(false);

  useEffect(() => {
    if (pointerHighlight.current) {
      pointerHighlight.current = false;
      return;
    }
    const frame = requestAnimationFrame(() =>
      activeRef.current?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, rows]);

  if (rows.length === 0) {
    return (
      <div className="min-h-0 flex-1 px-3 py-4 text-[12px] text-content/50">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      ref={desktop ? undefined : lockOverscroll}
      role="listbox"
      aria-label={uiT("Branches")}
      className="branch-menu-list min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        const selected = row.branch.current;
        return (
          <button
            key={`${row.branch.remote ?? "local"}:${row.branch.name}`}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={selected}
            data-highlighted={highlighted ? "true" : undefined}
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => {
              if (index !== active) pointerHighlight.current = true;
              onActive(index);
            }}
            onClick={() => onPick(row)}
            className={`branch-menu-option flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] disabled:opacity-60 ${
              highlighted || selected
                ? "bg-selection text-content"
                : "text-content hover:bg-content/3"
            }`}
          >
            {selected ? (
              <Check className="branch-menu-check size-3.5 shrink-0" />
            ) : (
              <GitBranch className="branch-menu-icon size-3.5 shrink-0 text-content/50" />
            )}
            <span
              data-code-label
              className={`branch-menu-name min-w-0 flex-1 truncate ${selected ? "font-medium" : ""}`}
            >
              {row.branch.name}
            </span>
            {row.branch.remote ? (
              <span data-code-label className="shrink-0 rounded bg-content/6 px-1.5 py-0.5 text-[10px] text-content/40">
                {row.branch.remote}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
