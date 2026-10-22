import { errorMessage } from "../../../shared/lib/errorMessage";
import { VirtualRows } from "../../../shared/ui/VirtualRows";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { projectSearchQuery, sessionSearchQuery } from "../model/searchQueries";
import { projectFilesQuery } from "../../connections/files/model/fileIndex";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  Folder,
  MessageSquare,
  Search,
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
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { HarnessIcon } from "../../../shared/ui/branding/HarnessIcon";
import { MatchText } from "../../../shared/ui/MatchText";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  conversationRowsFrom,
  flattenGrouped,
  groupHits,
  hitsFromContentMatches,
  hitsFromFileRanks,
  hitsFromSessionSearch,
  mergeHits,
  searchConversationTitles,
  searchRecentProjects,
  searchSessionMessages,
  type AppSearchHit,
  type SearchScope,
} from "../model/appSearch";
import {
  rankProjectFiles,
  recentOpenedFiles,
} from "../../connections/files/model/fileIndex";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import { parseWslPath } from "../../../shared/lib/wslPaths";
import {
  isLocalProject,
  type RecentProject,
} from "../../projects/model/recents";
import {
  type OpenFileFn,
} from "../model/search";
import { type Session } from "../../sessions/model/session";
import {
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import { Spinner } from "../../../shared/ui/primitives/Spinner";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { cn } from "../../../shared/lib/cn";

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "conversations", label: "Conversations" },
  { id: "files", label: "Files" },
  { id: "projects", label: "Projects" },
];
const searchableProject = (cwd: string) => isLocalProject(cwd) || !!parseWslPath(cwd);

type Props = {
  /** Whether this workspace view owns keyboard focus. Content stays mounted. */
  open: boolean;
  cwd: string;
  recents: RecentProject[];
  history: SessionSummary[];
  sessions: Session[];
  focusToken?: number;
  /** Fills the query, e.g. from Quick Open's "Search everywhere" row. */
  queryRequest?: { query: string; token: number };
  onClose: () => void;
  onOpenFile: OpenFileFn;
  onOpenSession: (sessionId: string, blockId?: string, query?: string) => void;
  onOpenProject: (path: string) => void;
};

export function SearchView({
  open,
  cwd,
  recents,
  history,
  sessions,
  focusToken = 0,
  queryRequest,
  onClose,
  onOpenFile,
  onOpenSession,
  onOpenProject,
}: Props) {
  const { t: uiT } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [active, setActive] = useState(0);
  const trimmed = query.trim();
  const { data: files = [] } = useQuery({ ...projectFilesQuery(cwd), staleTime: 0, enabled: open && searchableProject(cwd) }, queryClient);
  const wantSessions = !!trimmed && (scope === "all" || scope === "conversations");
  const wantFiles = !!trimmed && searchableProject(cwd) && (scope === "all" || scope === "files");
  const sessionQuery = useQuery({ ...sessionSearchQuery(trimmed), enabled: wantSessions }, queryClient);
  const contentQuery = useQuery({ ...projectSearchQuery({ cwd, query: trimmed }), enabled: wantFiles }, queryClient);
  const remoteHits = useMemo(() => wantSessions && sessionQuery.data ? hitsFromSessionSearch(sessionQuery.data.hits) : [], [wantSessions, sessionQuery.data]);
  const contentHits = useMemo(() => wantFiles && contentQuery.data ? hitsFromContentMatches(contentQuery.data.matches) : [], [wantFiles, contentQuery.data]);
  const loading = (wantSessions && sessionQuery.isFetching) || (wantFiles && contentQuery.isFetching);
  const error = wantFiles ? errorMessage(contentQuery.error) ?? null : null;
  const truncated = (wantSessions && sessionQuery.data?.truncated) || (wantFiles && contentQuery.data?.truncated);

  useEffect(() => {
    if (!queryRequest) return;
    setQuery(queryRequest.query);
    setScope("all");
    setActive(0);
  }, [queryRequest?.token]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const conversationRows = useMemo(
    () => conversationRowsFrom(history, sessions),
    [history, sessions],
  );
  const fileHits = useMemo(
    () =>
      trimmed && searchableProject(cwd)
        ? hitsFromFileRanks(
            rankProjectFiles(files, trimmed, recentOpenedFiles(cwd), 40),
          )
        : [],
    [cwd, files, trimmed],
  );
  const titleHits = useMemo(
    () => (trimmed ? searchConversationTitles(conversationRows, trimmed) : []),
    [conversationRows, trimmed],
  );
  const liveMessageHits = useMemo(
    () =>
      trimmed
        ? searchSessionMessages(
            sessions.map((session) => ({
              id: session.id,
              cwd: session.cwd,
              harness: session.harness,
              title: session.title,
              updatedAt: Date.now(),
              blocks: session.blocks,
            })),
            trimmed,
          )
        : [],
    [sessions, trimmed],
  );
  const projectHits = useMemo(
    () => (trimmed ? searchRecentProjects(recents, trimmed) : []),
    [recents, trimmed],
  );

  const hits = useMemo(() => {
    if (!trimmed) return [];
    return flattenGrouped(
      groupHits(
        mergeHits(
          titleHits,
          liveMessageHits,
          remoteHits,
          fileHits,
          contentHits,
          projectHits,
        ),
        scope,
      ),
    );
  }, [
    contentHits,
    fileHits,
    liveMessageHits,
    projectHits,
    remoteHits,
    scope,
    titleHits,
    trimmed,
  ]);

  const activeHit = hits[active] ?? null;

  useEffect(() => {
    setActive(0);
  }, [trimmed, scope]);

  useEffect(() => {
    if (active >= hits.length) setActive(0);
  }, [active, hits.length]);

  const openHit = (hit: AppSearchHit | null) => {
    if (!hit) return;
    if (hit.kind === "file") {
      onOpenFile(hit.path, undefined, { exact: true });
    } else if (hit.kind === "content") {
      onOpenFile(
        hit.path,
        { line: hit.line, column: hit.column },
        { exact: true },
      );
    } else if (hit.kind === "conversation") {
      onOpenSession(hit.sessionId);
    } else if (hit.kind === "message") {
      onOpenSession(hit.sessionId, hit.blockId, trimmed);
    } else onOpenProject(hit.path);
    onClose();
  };

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hits.length === 0) return;
      setActive((index) => (index + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length === 0) return;
      setActive((index) => (index - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openHit(activeHit);
    }
  };

  const empty = !trimmed;
  const noResults = !empty && hits.length === 0 && !loading;
  const limitNotice = truncated ? (
    <p className="px-2.5 py-1 text-[11px] text-content/45">
      {uiT("Results limited to the first matches")}
    </p>
  ) : null;

  return (
    <div
      role="search"
      aria-label={uiT("Search")}
      data-app-search
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div className="desktop-toolbar flex h-10 shrink-0 select-none items-center border-b border-stroke">
        <label className="flex min-w-0 flex-1 items-center gap-2 px-3 text-content/50">
          <Search className="size-3.5 shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder={uiT("Search everything...")}
            aria-label={uiT("Search")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="min-w-0 flex-1 border-0 bg-transparent px-0 text-[13px] text-content select-text placeholder:text-content/40"
          />
          {loading ? (
            <Spinner className="size-3.5 shrink-0 text-content/35" />
          ) : null}
        </label>
      </div>

      <div className="desktop-toolbar flex h-9 shrink-0 items-center gap-px border-b border-stroke px-3">
        {SCOPES.map((item) => {
          const selected = scope === item.id;
          return (
            <Button variant="ghost"
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setScope(item.id)}
              className={cn("rounded-md px-2 py-1 text-[12px]",
                selected
                  ? "bg-selection text-content"
                  : "text-content/50 hover:bg-content/3 hover:text-content"
              )}
            >
              {uiT(item.label)}
            </Button>
          );
        })}
      </div>

      <div
        ref={lockOverscroll}
        className={
          empty
            ? "flex min-h-0 flex-1 items-center justify-center overflow-y-auto overscroll-none"
            : "min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
        }
      >
        {empty ? (
          <EmptyState />
        ) : error && hits.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-danger">{error}</p>
        ) : noResults ? (
          <>
            <p className="px-2 py-1.5 text-[12px] text-content/50">
              {uiT("No results")}
            </p>
            {limitNotice}
          </>
        ) : (
          <>
            {limitNotice}
            <ResultList
              hits={hits}
              active={active}
              query={trimmed}
              onActive={setActive}
              onOpen={openHit}
            />
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY_DOT_COLS = 27;
const EMPTY_DOT_ROWS = 19;

function EmptyState() {
  const { t: uiT } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 pb-24">
      <div className="relative mb-2 grid h-48 w-72 place-items-center">
        <div
          className="grid gap-[7px] opacity-[0.14] [mask-image:radial-gradient(ellipse_72%_68%_at_50%_50%,#000_18%,transparent_76%)]"
          style={{
            gridTemplateColumns: `repeat(${EMPTY_DOT_COLS}, minmax(0, 1fr))`,
          }}
        >
          {Array.from(
            { length: EMPTY_DOT_COLS * EMPTY_DOT_ROWS },
            (_, index) => (
              <span
                key={index}
                className="mx-auto size-[3px] rounded-full bg-content"
              />
            ),
          )}
        </div>
        <div className="absolute grid size-14 place-items-center rounded-2xl bg-content/6 backdrop-blur-sm">
          <Search className="size-6 text-content/50" />
        </div>
      </div>

      <p className="max-w-xs text-center text-[13px] text-content/45">
        {uiT("Find files, conversations, messages, and projects.")}
      </p>
    </div>
  );
}

function ResultList({
  hits,
  active,
  query,
  onActive,
  onOpen,
}: {
  hits: AppSearchHit[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onOpen: (hit: AppSearchHit) => void;
}) {
  const { t: uiT } = useTranslation();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [hits]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    if (hits.length <= 80) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      event.clientX === pointer.current.x &&
      event.clientY === pointer.current.y
    ) {
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  return (
    <div
      role="listbox"
      aria-label={uiT("Search results")}
      onMouseMove={onListMouseMove}
    >
      <VirtualRows items={hits} getKey={hit => hit.id} activeIndex={active} scrollToActive={!fromPointer.current}>{(hit, index) => {
        const highlighted = index === active;
        const row = rowCopy(hit, query);
        return (
          <Button variant="ghost"
            key={hit.id}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onOpen(hit)}
            className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-none",
              highlighted ? "bg-selection text-content" : "text-content"
            )}
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {row.icon}
            </span>
            <span data-file-label={hit.kind === "file" || undefined} className="min-w-0 flex-1 truncate">{row.title}</span>
            {row.meta ? (
              <span className="min-w-0 max-w-[45%] truncate font-mono text-[11px] text-content/40">
                {row.meta}
              </span>
            ) : null}
          </Button>
        );
      }}</VirtualRows>
    </div>
  );
}

function rowCopy(
  hit: AppSearchHit,
  query: string,
): { icon: ReactNode; title: ReactNode; meta: string } {
  if (hit.kind === "conversation") {
    return {
      icon: <HarnessIcon harness={hit.harness} className="size-3.5" />,
      title: <MatchText text={hit.title} positions={hit.positions} active />,
      meta: projectName(hit.cwd),
    };
  }
  if (hit.kind === "message") {
    return {
      icon: (
        <MessageSquare
          className="size-3.5 text-content/55"
        />
      ),
      title: <Highlight text={hit.preview || hit.title} query={query} />,
      meta: hit.title,
    };
  }
  if (hit.kind === "file") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size={16} />,
      title: (
        <MatchText text={hit.name} positions={namePositions(hit)} active />
      ),
      meta: hit.relative,
    };
  }
  if (hit.kind === "content") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size={16} />,
      title: <Highlight text={hit.preview} query={query} />,
      meta: `${hit.relative}:${hit.line}`,
    };
  }
  return {
    icon: (
      <ProjectLogoIcon
        path={hit.path}
        className="size-3.5 rounded-sm"
        fallback={Folder}
      />
    ),
    title: <MatchText text={hit.name} positions={hit.positions} active />,
    meta: prettyCwd(hit.path),
  };
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return <>{text}</>;
  const end = index + needle.length;
  return (
    <>
      {text.slice(0, index)}
      <span className="text-accent">{text.slice(index, end)}</span>
      {text.slice(end)}
    </>
  );
}

function namePositions(hit: {
  name: string;
  relative: string;
  positions: number[];
}) {
  const offset = Math.max(0, hit.relative.length - hit.name.length);
  return hit.positions
    .map((index) => index - offset)
    .filter((index) => index >= 0 && index < hit.name.length);
}
