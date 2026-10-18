import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatMobileRelativeTime } from "../../../mobile/relativeTime";
import { gitHistory, type GitHistoryCommit } from "../../../platform/tauri/fs";
import { LAYER } from "../../../shared/lib/layers";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Popover } from "../../../shared/ui/Popover";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { Check, ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { reviewCommit, type ReviewSource } from "../model/reviewDiff";
import "./ReviewSourceSelect.css";

const COMMIT_LIMIT = 20;

type Entry =
  | { kind: "option"; value: ReviewSource; label: string }
  | { kind: "commits"; label: string };

/** The current branch's commits, newest first, following first parents from HEAD. */
export function branchCommits(
  head: string | null,
  commits: readonly GitHistoryCommit[],
): GitHistoryCommit[] {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const out: GitHistoryCommit[] = [];
  for (let sha = head; sha && out.length < COMMIT_LIMIT;) {
    const commit = bySha.get(sha);
    if (!commit) break;
    out.push(commit);
    sha = commit.parents[0] ?? null;
  }
  return out;
}

export function ReviewSourceSelect({
  cwd,
  value,
  sessionId,
  gitAvailable,
  onChange,
  trailing,
}: {
  cwd: string;
  value: ReviewSource;
  sessionId?: string;
  gitAvailable: boolean;
  onChange: (value: ReviewSource) => void;
  /** Optional content after the chevron. */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [submenu, setSubmenu] = useState(false);
  // Keyboard focus stays on the main menu; this moves its active row into the flyout.
  const [inSubmenu, setInSubmenu] = useState(false);
  const [commitActive, setCommitActive] = useState(0);
  const [history, setHistory] = useState<{
    cwd: string;
    commits: GitHistoryCommit[] | null;
    error?: string;
  }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const commitsRow = useRef<HTMLButtonElement>(null);
  const commitList = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const submenuId = `${menuId}-commits`;
  const shown = open && visible && (gitAvailable || !!sessionId);
  const groups: Entry[][] = [
    ...(sessionId
      ? [
          [
            {
              kind: "option" as const,
              value: "session" as const,
              label: t("Session changes"),
            },
          ],
        ]
      : []),
  ];
  if (gitAvailable) {
    groups.push(
      [
        { kind: "option", value: "uncommitted", label: t("Uncommitted") },
        { kind: "option", value: "unstaged", label: t("Unstaged") },
        { kind: "option", value: "staged", label: t("Staged") },
      ],
      [
        { kind: "commits", label: t("Committed") },
        { kind: "option", value: "branch", label: t("Branch") },
      ],
    );
  }
  const entries = groups.flat();
  const selectedCommit = reviewCommit(value);
  const isSelected = (entry: Entry) =>
    entry.kind === "commits"
      ? selectedCommit !== undefined
      : entry.value === value;
  const label = t("Review source");
  const selectedLabel = entries.find(isSelected)?.label ?? t("Review source");
  const activeIndex = Math.min(active, entries.length - 1);
  const commits = history && history.cwd === cwd ? history.commits : null;
  const commitIndex = Math.min(
    commitActive,
    Math.max(0, (commits?.length ?? 1) - 1),
  );

  useEffect(() => {
    if (!visible || (!gitAvailable && !sessionId)) setOpen(false);
  }, [visible, gitAvailable, sessionId]);
  useEffect(() => {
    if (!shown || !gitAvailable) {
      setSubmenu(false);
      setInSubmenu(false);
    }
  }, [shown, gitAvailable]);
  // Load the branch's commits each time the flyout opens; history can move.
  useEffect(() => {
    if (!shown || !submenu || !gitAvailable || !cwd) return;
    let stale = false;
    // History also walks the upstream and default branch; fetch extra to fill the list.
    void gitHistory(cwd, COMMIT_LIMIT * 3).then(
      (result) => {
        if (stale) return;
        const list = branchCommits(result.head, result.commits);
        setHistory({ cwd, commits: list });
        const selected = list.findIndex(
          (commit) => commit.sha === selectedCommit,
        );
        setCommitActive(Math.max(0, selected));
      },
      (error: unknown) => {
        if (!stale)
          setHistory({
            cwd,
            commits: [],
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      stale = true;
    };
  }, [shown, submenu, gitAvailable, cwd, selectedCommit]);
  useEffect(() => {
    if (!inSubmenu) return;
    commitList.current
      ?.querySelector(`#${CSS.escape(`${submenuId}-${commitIndex}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [inSubmenu, commitIndex, submenuId]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const openMenu = (keyboard = false) => {
    setActive(Math.max(0, entries.findIndex(isSelected)));
    setKeyboardNavigation(keyboard);
    setOpen(true);
  };
  const pick = (next: ReviewSource) => {
    onChange(next);
    close(true);
  };
  const enterSubmenu = () => {
    setSubmenu(true);
    setInSubmenu(true);
    setKeyboardNavigation(true);
  };

  const rowClass = (highlight: boolean) =>
    `flex min-h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-ui-base outline-none hover:bg-menu-hover ${highlight ? "bg-menu-hover" : ""}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${selectedLabel}`}
        aria-expanded={shown}
        disabled={entries.length === 0}
        aria-haspopup="listbox"
        aria-controls={shown ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!open) openMenu(true);
        }}
        className="review-source-select flex h-8 min-w-0 shrink items-center gap-1.5 rounded-lg border pr-2 pl-3 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-content/25"
      >
        <span className="min-w-0 truncate" title={selectedLabel}>
          {selectedLabel}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-foreground-subtle" />
        {trailing}
      </button>
      {visible ? (
        <Popover
          open={shown}
          anchor={trigger}
          align="start"
          gap={4}
          width={176}
          bare
          autoFocus={open}
          id={menuId}
          role="listbox"
          data-menu-density="compact"
          aria-label={label}
          aria-activedescendant={
            inSubmenu && commits?.length
              ? `${submenuId}-${commitIndex}`
              : `${menuId}-option-${activeIndex}`
          }
          tabIndex={-1}
          data-fold-state={shown ? "open" : "closed"}
          inert={!open}
          aria-hidden={!open || undefined}
          ignore=".review-source-commits"
          onDismiss={open ? (reason) => close(reason === "escape") : undefined}

          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "Tab") {
              close(true);
              return;
            }
            if (inSubmenu) {
              const list = commits ?? [];
              if (event.key === "ArrowLeft" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setInSubmenu(false);
                setSubmenu(false);
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (list[commitIndex]) pick(`commit:${list[commitIndex].sha}`);
                return;
              }
              const next =
                event.key === "ArrowDown"
                  ? Math.min(list.length - 1, commitIndex + 1)
                  : event.key === "ArrowUp"
                    ? Math.max(0, commitIndex - 1)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? list.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setCommitActive(Math.max(0, next));
              return;
            }
            const entry = entries[activeIndex];
            if (!entry) return;
            if (
              entry.kind === "commits" &&
              (event.key === "ArrowRight" ||
                event.key === "Enter" ||
                event.key === " ")
            ) {
              event.preventDefault();
              enterSubmenu();
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (entry.kind === "option") pick(entry.value);
              return;
            }
            const next =
              event.key === "ArrowDown"
                ? Math.min(entries.length - 1, activeIndex + 1)
                : event.key === "ArrowUp"
                  ? Math.max(0, activeIndex - 1)
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? entries.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            setActive(next);
            setSubmenu(false);
            setKeyboardNavigation(true);
          }}
          className="review-source-menu flex w-44 flex-col overflow-y-auto rounded-lg border p-1 text-content"
        >
          {groups.map((group, groupIndex) => (
            <Fragment key={groupIndex}>
              {groupIndex > 0 ? (
                <div
                  role="separator"
                  className="mx-2.5 my-1 h-px shrink-0 bg-stroke"
                />
              ) : null}
              {group.map((entry) => {
                const index = entries.indexOf(entry);
                const highlight =
                  (keyboardNavigation && index === activeIndex) ||
                  (entry.kind === "commits" && submenu);
                return entry.kind === "commits" ? (
                  <button
                    key="commits"
                    ref={commitsRow}
                    id={`${menuId}-option-${index}`}
                    type="button"
                    role="option"
                    data-menu-row="single"
                    aria-selected={isSelected(entry)}
                    aria-haspopup="listbox"
                    aria-expanded={submenu}
                    aria-controls={submenu ? submenuId : undefined}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setKeyboardNavigation(false);
                      setInSubmenu(false);
                      setSubmenu(true);
                    }}
                    onClick={() => {
                      if (open) setSubmenu(true);
                    }}
                    className={rowClass(highlight)}
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={entry.label}
                    >
                      {entry.label}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-foreground-subtle" />
                  </button>
                ) : (
                  <button
                    key={entry.value}
                    id={`${menuId}-option-${index}`}
                    type="button"
                    role="option"
                    data-menu-row="single"
                    aria-selected={isSelected(entry)}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setKeyboardNavigation(false);
                      setInSubmenu(false);
                      setSubmenu(false);
                    }}
                    onClick={() => {
                      if (open) pick(entry.value);
                    }}
                    className={rowClass(highlight)}
                  >
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={entry.label}
                    >
                      {entry.label}
                    </span>
                    <span className="grid size-4 shrink-0 place-items-center">
                      {isSelected(entry) ? (
                        <Check className="size-4 text-foreground-subtle" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </Popover>
      ) : null}
      {visible && gitAvailable ? (
        <Popover
          open={shown && submenu && gitAvailable}
          anchor={commitsRow}
          side="right"
          align="start"
          gap={6}
          width={440}
          maxHeight={400}
          layer={LAYER.submenu}
          bare
          id={submenuId}
          role="listbox"
          data-menu-density="compact"
          aria-label={t("Committed")}
          data-fold-state={shown && submenu ? "open" : "closed"}
          inert={!(shown && submenu)}
          aria-hidden={!(shown && submenu) || undefined}

          ref={commitList}
          className="review-source-menu review-source-commits flex max-h-[400px] flex-col overflow-y-auto overscroll-contain rounded-lg border p-1 text-content"
        >
          {commits == null ? (
            <div className="px-2.5 py-2 text-ui-caption text-foreground-subtle">
              {t("Loading…")}
            </div>
          ) : !commits.length ? (
            <div className="px-2.5 py-2 text-ui-caption text-foreground-subtle">
              {history?.error ?? t("No commits yet")}
            </div>
          ) : (
            commits.map((commit, index) => {
              const selected = commit.sha === selectedCommit;
              return (
                <button
                  key={commit.sha}
                  id={`${submenuId}-${index}`}
                  type="button"
                  role="option"
                  data-menu-row="single"
                  aria-selected={selected}
                  tabIndex={-1}
                  title={`${commit.shortSha} · ${commit.author}\n${commit.subject}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setCommitActive(index);
                    setInSubmenu(false);
                  }}
                  onClick={() => pick(`commit:${commit.sha}`)}
                  className={rowClass(inSubmenu && index === commitIndex)}
                >
                  <span data-code-label className="min-w-0 truncate">{commit.subject}</span>
                  <span className="shrink-0 text-ui-caption text-foreground-subtle">
                    {formatMobileRelativeTime(commit.timestamp * 1000)}
                  </span>
                  <span className="ml-auto grid size-4 shrink-0 place-items-center">
                    {selected ? (
                      <Check className="size-4 text-foreground-subtle" />
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </Popover>
      ) : null}
    </>
  );
}
