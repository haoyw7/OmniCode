import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { FolderOpen, FolderPlus, Search, Zap } from "../../../shared/ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../shared/ui/primitives/Command";
import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import {
  projectFilesQuery,
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
  renderSessionIcon?: (harness: SessionRow["harness"]) => ReactNode;
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
  renderSessionIcon,
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
  const search = useRef<HTMLInputElement>(null);
  // Focus goes back where it was before a command runs, so editor commands
  // act on the editor the palette was opened from.
  const previousFocus = useRef<Element | null>(null);
  const commandScheduled = useRef(false);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState("");
  const filesQuery = useQuery(
    {
      ...projectFilesQuery(cwd),
      staleTime: 0,
      enabled: open && looksLikeProject(cwd),
    },
    queryClient,
  );
  const files = filesQuery.data ?? [];
  const loading = open && looksLikeProject(cwd) && filesQuery.isPending;
  const error = errorMessage(filesQuery.error) ?? null;
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
  const activeValue = items.some((item) => item.key === active)
    ? active
    : (items[0]?.key ?? "");

  useEffect(() => {
    if (!open) return;
    commandScheduled.current = false;
    setQuery(initialQuery);
    setActive("");
  }, [open, cwd, initialQuery]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
  }, [open]);

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
      commandScheduled.current = true;
      onClose();
      requestAnimationFrame(() => {
        restoreFocus();
        onRunCommand(id);
      });
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
    setActive("");
    search.current?.focus();
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSearchEverywhere) {
      e.preventDefault();
      choose({ kind: "search-everywhere", key: "search-everywhere" });
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

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={dialogLabel}
      contentProps={{
        "data-file-picker": true,
        "data-quick-open-mode": mode,
        "aria-label": dialogLabel,
        onOpenAutoFocus: (event) => {
          event.preventDefault();
          previousFocus.current = document.activeElement;
          search.current?.focus();
        },
        onCloseAutoFocus: (event) => {
          event.preventDefault();
          if (!commandScheduled.current) restoreFocus();
        },
        onMouseDown: (e) => e.stopPropagation(),
        style: { zIndex: LAYER.dialog },
      }}
      className="quick-open-panel popover-backdrop top-[max(24px,calc(50%-310px))] flex w-[min(760px,calc(100vw-48px))] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0"
    >
      <Command
        shouldFilter={false}
        loop
        value={activeValue}
        onValueChange={setActive}
        label={dialogLabel}
      >
        <div className="pb-1.5">
          <CommandInput
            ref={search}
            wrapperClassName="gap-2.5 px-3.5 py-3.5 text-content/50"
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
            onValueChange={(next) => {
              setQuery(next);
              setActive("");
            }}
            onKeyDown={onSearchKey}
          />
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
              <Button
                variant="ghost"
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
              </Button>
            ))}
          </div>
        </div>
        {empty ? (
          <p className="px-3 pb-1 pt-1 text-[12px] text-content/50">
            {uiT(empty)}
          </p>
        ) : null}
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
          onChoose={choose}
          render={(item) =>
            renderItem(item, {
              query: modeQuery,
              highlight: highlightQuery,
              shortcut: commandShortcut,
                sessionIcon: renderSessionIcon,
              t: uiT,
            })
          }
        />
      </Command>
    </CommandDialog>
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
    sessionIcon,
    t,
  }: {
    query: string;
    highlight: boolean;
    shortcut?: (id: string) => string | null;
    sessionIcon?: (harness: SessionRow["harness"]) => ReactNode;
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
        <span className="grid size-4 shrink-0 place-items-center">{sessionIcon?.(item.hit.harness)}</span>
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
        <FolderOpen className="size-4 shrink-0 text-content/50" />
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
        <FolderPlus className="size-4 shrink-0 text-content/50" />
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
  onChoose,
  render,
}: {
  label: string;
  items: Item[];
  onChoose: (item: Item) => void;
  render: (item: Item) => ReactNode;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <CommandList
      ref={lockOverscroll}
      label={label}
      className="max-h-[min(520px,60vh)] overflow-y-auto overscroll-none px-1.5 pb-1.5"
    >
      {items.map((item) => {
        return (
          <CommandItem
            key={item.key}
            value={item.key}
            data-quick-open-item={item.kind}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => onChoose(item)}
            className={cn(
              "h-8 w-full text-sm leading-none",
              item.kind === "search-everywhere" && "mt-1",
            )}
          >
            {render(item)}
          </CommandItem>
        );
      })}
    </CommandList>
  );
}
