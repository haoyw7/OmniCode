import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Search,
  Zap,
} from "../../../shared/ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  loadProjectFiles,
  peekProjectFiles,
  rankProjectFiles,
  recentOpenedFiles,
  rememberOpenedFile,
  type RankedFile,
} from "../../connections/files/model/fileIndex";
import { LAYER } from "../../../shared/lib/layers";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import type { OpenFileFn } from "../model/search";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { projectName } from "../../../shared/lib/paths";
import { MOD } from "../../../platform/tauri/platform";
import type { TranslationValues } from "../../../shared/i18n/language";
import {
  loadRecentCommands,
  parseQuickOpenQuery,
  quickOpenQueryFor,
  rankCommands,
  rankProjects,
  rankSessions,
  rememberCommand,
  type QuickOpenCommand,
  type QuickOpenMode,
  type RankedCommand,
  type SessionRow,
} from "../model/quickOpen";
import type { ConversationHit, ProjectHit } from "../model/appSearch";

type Item =
  | { kind: "file"; key: string; file: RankedFile }
  | { kind: "command"; key: string; command: RankedCommand }
  | { kind: "session"; key: string; hit: ConversationHit }
  | { kind: "project"; key: string; hit: ProjectHit }
  | { kind: "open-project"; key: string }
  | { kind: "search-everywhere"; key: string };

type Props = {
  open: boolean;
  cwd: string;
  openPaths?: string[];
  initialQuery?: string;
  commands?: QuickOpenCommand[];
  /** Effective shortcut labels, read when the palette renders. */
  commandShortcut?: (id: string) => string | null;
  sessions?: SessionRow[];
  recents?: RecentProject[];
  currentProject?: string | null;
  onOpenFile: OpenFileFn;
  onRunCommand: (id: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenProject?: (path: string) => void;
  onAddProject?: () => void;
  onSearchEverywhere?: (query: string) => void;
  onClose: () => void;
};

const MODES: { mode: QuickOpenMode; label: string; prefix?: string }[] = [
  { mode: "files", label: "Files" },
  { mode: "commands", label: "Commands", prefix: ">" },
  { mode: "sessions", label: "Sessions", prefix: "#" },
  { mode: "projects", label: "Projects", prefix: "@" },
];

const DIALOG_LABELS: Record<QuickOpenMode, string> = {
  files: "Go to File",
  commands: "Command Palette",
  sessions: "Go to Session",
  projects: "Go to Project",
};

export function QuickOpen({
  open,
  cwd,
  openPaths = [],
  initialQuery = "",
  commands = [],
  commandShortcut,
  sessions = [],
  recents = [],
  currentProject = null,
  onOpenFile,
  onRunCommand,
  onOpenSession,
  onOpenProject,
  onAddProject,
  onSearchEverywhere,
  onClose,
}: Props) {
  const { t: uiT } = useTranslation();
  const peekFiles = () => peekProjectFiles(cwd);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Focus goes back where it was before a command runs, so editor commands
  // act on the editor the palette was opened from.
  const previousFocus = useRef<Element | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState(() => peekFiles() ?? []);
  const [loading, setLoading] = useState(() => peekFiles() == null);
  const [error, setError] = useState<string | null>(null);
  const [recentCommands] = useState(loadRecentCommands);

  const recentFiles = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const path of [...recentOpenedFiles(cwd), ...openPaths]) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  }, [cwd, openPaths, open]);
  const { mode, query: modeQuery } = parseQuickOpenQuery(query);
  const sessionsAvailable = Boolean(onOpenSession);
  const projectsAvailable = Boolean(onOpenProject);

  const items = useMemo((): Item[] => {
    const out: Item[] = [];
    if (mode === "files") {
      for (const file of rankProjectFiles(files, modeQuery, recentFiles)) {
        out.push({ kind: "file", key: `file:${file.path}`, file });
      }
    } else if (mode === "commands") {
      for (const command of rankCommands(
        commands,
        modeQuery,
        uiT,
        recentCommands,
      )) {
        out.push({ kind: "command", key: `command:${command.id}`, command });
      }
    } else if (mode === "sessions" && sessionsAvailable) {
      for (const hit of rankSessions(sessions, modeQuery, currentProject)) {
        out.push({ kind: "session", key: hit.id, hit });
      }
    } else if (mode === "projects" && projectsAvailable) {
      for (const hit of rankProjects(recents, modeQuery)) {
        out.push({ kind: "project", key: hit.id, hit });
      }
      if (onAddProject) out.push({ kind: "open-project", key: "open-project" });
    }
    if (onSearchEverywhere) {
      out.push({ kind: "search-everywhere", key: "search-everywhere" });
    }
    return out;
  }, [
    commands,
    currentProject,
    files,
    mode,
    modeQuery,
    onAddProject,
    onSearchEverywhere,
    projectsAvailable,
    recentCommands,
    recentFiles,
    recents,
    sessions,
    sessionsAvailable,
    uiT,
  ]);
  const optionCount = items.length;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    setQuery(initialQuery);
    setActive(0);
    setError(null);
    const searchable = looksLikeProject(cwd);
    const cached = peekFiles();
    if (cached) {
      setFiles(cached);
      setLoading(false);
    } else {
      setFiles([]);
      setLoading(searchable);
    }
    if (!searchable) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadProjectFiles(cwd, true)
      .then((next) => {
        if (cancelled) return;
        setFiles(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cwd, initialQuery]);

  useEffect(() => {
    setActive((index) =>
      optionCount === 0 ? 0 : Math.min(index, optionCount - 1),
    );
  }, [optionCount]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const restoreFocus = () => {
    const target = previousFocus.current;
    if (target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
    }
  };

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "file") {
      rememberOpenedFile(cwd, item.file.path);
      onOpenFile(item.file.path, undefined, { exact: true });
      onClose();
    } else if (item.kind === "command") {
      const id = item.command.id;
      rememberCommand(id);
      onClose();
      restoreFocus();
      requestAnimationFrame(() => onRunCommand(id));
    } else if (item.kind === "session") {
      onOpenSession?.(item.hit.sessionId);
      onClose();
    } else if (item.kind === "project") {
      onOpenProject?.(item.hit.path);
      onClose();
    } else if (item.kind === "open-project") {
      onClose();
      onAddProject?.();
    } else {
      onClose();
      onSearchEverywhere?.(modeQuery.trim());
    }
  };

  const setMode = (next: QuickOpenMode) => {
    setQuery((current) => quickOpenQueryFor(next, current));
    setActive(0);
    search.current?.focus();
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (optionCount === 0) return;
      setActive((index) => (index + 1) % optionCount);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount === 0) return;
      setActive((index) => (index - 1 + optionCount) % optionCount);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && onSearchEverywhere) {
        choose({ kind: "search-everywhere", key: "search-everywhere" });
        return;
      }
      choose(items[active]);
      return;
    }
    if (e.key === "Tab") e.preventDefault();
  };

  const empty = emptyLabel({
    mode,
    cwd,
    query: modeQuery,
    loading,
    error,
    fileCount: files.length,
    itemCount: items.filter((item) => item.kind !== "search-everywhere").length,
  });
  const dialogLabel = uiT(DIALOG_LABELS[mode]);
  const highlightQuery = Boolean(modeQuery.trim());

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="modal-backdrop absolute inset-0 bg-black/40"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-label={dialogLabel}
        data-file-picker
        data-quick-open-mode={mode}
        onMouseDown={(e) => e.stopPropagation()}
        className="quick-open-panel popover-backdrop absolute left-1/2 top-[max(24px,calc(50%-310px))] flex w-[min(760px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-content/10 shadow-2xl backdrop-blur-xl"
      >
        <div className="pb-1.5">
          <label className="flex items-center gap-2.5 border-b border-stroke px-3.5 py-3.5 text-content/50">
            <Search className="size-4 shrink-0" />
            <input
              ref={search}
              type="text"
              value={query}
              placeholder={uiT(
                "Search files (type > for commands, # for sessions, @ for projects)",
              )}
              aria-label={dialogLabel}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-content outline-none placeholder:text-content/40"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <div
            role="tablist"
            aria-label={uiT("Quick open modes")}
            className="flex items-center gap-1 px-3 py-2"
          >
            {MODES.filter(
              ({ mode: entry }) =>
                (entry !== "sessions" || sessionsAvailable) &&
                (entry !== "projects" || projectsAvailable),
            ).map(({ mode: entry, label, prefix }) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={entry === mode}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMode(entry)}
                className="surface-tab flex h-6 items-center gap-1 px-2 text-[11px]"
              >
                {uiT(label)}
                {prefix ? (
                  <span className="font-mono text-content/40">{prefix}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        {empty ? (
          <p className="px-3 pb-1 pt-1 text-[12px] text-content/50">
            {uiT(empty)}
          </p>
        ) : null}
        {items.length > 0 ? (
          <OptionList
            label={uiT(
              mode === "files"
                ? "Files"
                : mode === "commands"
                  ? "Commands"
                  : mode === "sessions"
                    ? "Sessions"
                    : "Projects",
            )}
            items={items}
            active={active}
            onActive={setActive}
            onChoose={choose}
            render={(item) =>
              renderItem(item, {
                query: modeQuery,
                highlight: highlightQuery,
                shortcut: commandShortcut,
                t: uiT,
              })
            }
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function emptyLabel({
  mode,
  cwd,
  query,
  loading,
  error,
  fileCount,
  itemCount,
}: {
  mode: QuickOpenMode;
  cwd: string;
  query: string;
  loading: boolean;
  error: string | null;
  fileCount: number;
  itemCount: number;
}): string | null {
  if (mode === "commands")
    return itemCount === 0 ? "No matching commands" : null;
  if (mode === "sessions") {
    if (itemCount > 0) return null;
    return query.trim() ? "No matching sessions" : "No sessions yet";
  }
  if (mode === "projects") {
    return itemCount === 0 && query.trim() ? "No matching projects" : null;
  }
  if (error && fileCount === 0) return error;
  if (!looksLikeProject(cwd)) return "Open a project to search files";
  if (loading && fileCount === 0) return "Indexing files…";
  if (fileCount === 0) return "No files found";
  if (itemCount === 0) {
    return query.trim() ? "No matching files" : "Type a file name to search";
  }
  return null;
}

function renderItem(
  item: Item,
  {
    query,
    highlight,
    shortcut,
    t,
  }: {
    query: string;
    highlight: boolean;
    shortcut?: (id: string) => string | null;
    t: (text: string, values?: TranslationValues) => string;
  },
): ReactNode {
  if (item.kind === "file") {
    const { file } = item;
    const slash = file.relative.lastIndexOf("/");
    const dir = slash === -1 ? "" : file.relative.slice(0, slash);
    const nameOffset = slash === -1 ? 0 : slash + 1;
    return (
      <>
        <span className="shrink-0">
          <FileTypeIcon name={file.name} isDir={false} />
        </span>
        <span data-file-label className="min-w-0 flex-1 truncate">
          <MatchText
            text={file.name}
            positions={file.positions
              .filter((pos) => pos >= nameOffset)
              .map((pos) => pos - nameOffset)}
            active={highlight}
          />
        </span>
        {dir ? (
          <span className="min-w-0 max-w-[45%] truncate font-mono text-[11px] text-content/40">
            <MatchText
              text={dir}
              positions={file.positions.filter((pos) => pos < slash)}
              active={highlight}
            />
          </span>
        ) : null}
      </>
    );
  }
  if (item.kind === "command") {
    const keys = shortcut?.(item.command.id);
    return (
      <>
        <Zap className="size-4 shrink-0 text-content/50" />
        <span className="min-w-0 flex-1 truncate">
          <MatchText
            text={item.command.label}
            positions={item.command.positions}
            active={highlight}
          />
        </span>
        {keys ? (
          <kbd className="ml-auto shrink-0 rounded border border-content/10 bg-content/5 px-1.5 py-0.5 font-mono text-[10px] text-content/50">
            {keys}
          </kbd>
        ) : null}
      </>
    );
  }
  if (item.kind === "session") {
    return (
      <>
        <MessageSquare
          className="size-4 shrink-0 text-content/50"
        />
        <span className="min-w-0 flex-1 truncate">
          <MatchText
            text={item.hit.title}
            positions={item.hit.positions}
            active={highlight}
          />
        </span>
        <span className="min-w-0 max-w-[40%] shrink-0 truncate text-[11px] text-content/40">
          {item.hit.cwd === "~" ? "" : projectName(item.hit.cwd)}
        </span>
      </>
    );
  }
  if (item.kind === "project") {
    return (
      <>
        <FolderOpen
          className="size-4 shrink-0 text-content/50"
        />
        <span className="shrink-0 truncate">
          <MatchText
            text={item.hit.name}
            positions={item.hit.positions}
            active={highlight}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-content/40">
          {item.hit.path}
        </span>
      </>
    );
  }
  if (item.kind === "open-project") {
    return (
      <>
        <FolderPlus
          className="size-4 shrink-0 text-content/50"
        />
        <span className="min-w-0 flex-1 truncate">{t("Open Project…")}</span>
      </>
    );
  }
  return (
    <>
      <Search className="size-4 shrink-0 text-content/50" />
      <span className="min-w-0 flex-1 truncate">
        {query.trim()
          ? t("Search everywhere for “{query}”", { query: query.trim() })
          : t("Search everywhere")}
      </span>
      <kbd className="ml-auto shrink-0 rounded border border-content/10 bg-content/5 px-1.5 py-0.5 font-mono text-[10px] text-content/50">
        {`${MOD}Enter`}
      </kbd>
    </>
  );
}

function OptionList({
  label,
  items,
  active,
  onActive,
  onChoose,
  render,
}: {
  label: string;
  items: Item[];
  active: number;
  onActive: (index: number) => void;
  onChoose: (item: Item) => void;
  render: (item: Item) => ReactNode;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  // Rows under a still pointer must not steal the selection while the list
  // scrolls under keyboard navigation.
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [items]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label={label}
      onMouseMove={onListMouseMove}
      className="max-h-[min(520px,60vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {items.map((item, index) => {
        const highlighted = index === active;
        return (
          <button
            key={item.key}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={highlighted}
            data-quick-open-item={item.kind}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onChoose(item)}
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm leading-none ${
              highlighted ? "bg-selection text-content" : "text-content"
            } ${item.kind === "search-everywhere" ? "mt-1" : ""}`}
          >
            {render(item)}
          </button>
        );
      })}
    </div>
  );
}
