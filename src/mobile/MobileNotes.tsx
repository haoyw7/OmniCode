import { Button } from "../shared/ui/forms/Button";
import { IconButton } from "../shared/ui/forms/IconButton";
import { MobileSpinner } from "./MobileSpinner";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  ArrowLeft,
  File,
  RefreshCw,
  Search,
  X,
} from "../shared/ui/icons";
import { translate } from "../shared/i18n/language";
import { useTranslation } from "../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { AgentMarkdown } from "../features/sessions/ui/AgentMarkdown";
import { BotTopicNote as AssistantTopicNote } from "../features/bots/ui/BotTopicNote";
import { useBotTopicNotes as useAssistantTopicNotes } from "../features/bots/model/useBotTopicNotes";
import { TranscriptPlatformContext } from "../features/sessions/ui/TranscriptPlatform";
import {
  notePreview,
  noteSourceProject,
  type Note,
} from "../features/notes/notesText";
import type { HostProject } from "../features/connections/model/protocol";
import type { MobileClient } from "./client";
import { MobilePageTransition } from "./MobilePageTransition";
import { mobileTranscriptPlatform } from "./transcriptPlatform";
import { formatMobileRelativeTime } from "./relativeTime";
import { MobileEmpty } from "./MobileEmpty";
import "./styles/notes.css";

export type MobileNotesHandle = { back: () => void };
type NotesApi = ReturnType<typeof scopedNotes>;
function scopedNotes(client: MobileClient, hostKey: string) {
  const check = () => {
    if (client.connection?.endpoint !== hostKey)
      throw new Error(translate("Host connection changed."));
  };
  return {
    rpc: async <T,>(method: string, params?: object): Promise<T> => {
      check();
      return client.rpc<T>(method, params);
    },
    list: () => {
      check();
      return client.listNotes();
    },
    get: (id: string) => {
      check();
      return client.getNote(id);
    },
    resolveImage: async (asset: string) => {
      check();
      const image = await client.noteImage(asset);
      return `data:${image.mime};base64,${image.data}`;
    },
  };
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function MobileNotes({
  ref,
  client,
  hostKey,
  hostName,
  projects,
  onClose,
  onAddToChat,
}: {
  ref?: Ref<MobileNotesHandle>;
  client: MobileClient;
  hostKey: string;
  hostName?: string;
  projects: HostProject[];
  onClose: () => void;
  onAddToChat: (note: Note) => Promise<void>;
}) {
  const { language, t } = useTranslation();
  const visible = useSurfaceVisibility();
  const api = useMemo(() => scopedNotes(client, hostKey), [client, hostKey]);
  const topicSources = useMemo(() => [{
    key: hostKey,
    name: hostName ?? hostKey,
    rpc: api.rpc,
  }], [api, hostKey, hostName]);
  const topics = useAssistantTopicNotes(topicSources, visible);
  const [selectedTopicKey, setSelectedTopicKey] = useState<string>();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const viewer = useRef<MobileNotesHandle>(null);
  const live = useRef(true);
  const operation = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.list();
      if (live.current) {
        setNotes(next);
        setError("");
      }
    } catch (problem) {
      if (live.current) setError(errorMessage(problem));
    } finally {
      if (live.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const back = () => {
    if (operation.current) return;
    if (selectedTopicKey) {
      setSelectedTopicKey(undefined);
      topics.refresh();
    } else if (selectedId) viewer.current?.back();
    else onClose();
  };
  useImperativeHandle(ref, () => ({ back }));
  const loaded = (note: Note) =>
    setNotes((current) =>
      [note, ...current.filter((item) => item.id !== note.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
      ),
    );
  const open = async (id: string) => {
    if (operation.current || loading || !visible) return;
    operation.current = true;
    setWorking(true);
    try {
      const note = await api.get(id);
      if (!note) throw new Error(t("Note was not found."));
      if (live.current) {
        loaded(note);
        setSelectedId(note.id);
        setError("");
      }
    } catch (problem) {
      if (live.current) setError(errorMessage(problem));
    } finally {
      operation.current = false;
      if (live.current) setWorking(false);
    }
  };
  const needle = query.trim().toLowerCase();
  const filtered = notes.filter(
    (note) =>
      !needle ||
      note.title.toLowerCase().includes(needle) ||
      note.body.toLowerCase().includes(needle) ||
      note.slug.toLowerCase().includes(needle) ||
      note.tags.some((tag) => tag.includes(needle.replace(/^#/, ""))) ||
      (noteSourceProject(note.sourceCwd)?.toLowerCase() ?? "").includes(needle),
  );
  const selected = notes.find((note) => note.id === selectedId);
  const selectedTopic = topics.notes.find((note) => note.key === selectedTopicKey);
  const filteredTopics = topics.notes.filter((note) =>
    `${note.name} ${note.source.name}`.toLowerCase().includes(needle),
  );
  return (
    <aside
      className="mobile-notes"
      aria-label={t("Notes")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          back();
        }
      }}
    >
      <MobilePageTransition
        route={{
          key: selectedTopic ? `topic:${selectedTopic.key}` : selected ? `note:${selected.id}` : "notes",
          section: "home",
          depth: selectedTopic || selected ? 1 : 0,
        }}
        slide
      >
        {selectedTopic ? (
          <>
            <header className="mobile-notes-header">
              <IconButton className="mobile-sheet-header-button" label={t("Back")} disabled={!visible} onClick={back}>
                <ArrowLeft size={24} />
              </IconButton>
              <h1>{t("Assistant memory")}</h1>
              <File size={20} aria-hidden="true" />
            </header>
            <TranscriptPlatformContext.Provider value={mobileTranscriptPlatform}>
              <AssistantTopicNote key={selectedTopic.key} note={selectedTopic} active={visible} />
            </TranscriptPlatformContext.Provider>
          </>
        ) : selected ? (
          <MobileNoteViewer
            key={selected.id}
            ref={viewer}
            api={api}
            note={selected}
            projects={projects}
            onBack={() => {
              setSelectedId(undefined);
              void refresh();
            }}
            onAddToChat={onAddToChat}
          />
        ) : (
          <>
            <header className="mobile-notes-header">
              <IconButton
                className="mobile-sheet-header-button"
                label={t("Close")}
                onClick={back}
              >
                <X size={24} />
              </IconButton>
              <h1>{t("Notes")}</h1>
              {working ? (
                <MobileSpinner
                  size={22}
                  className="mobile-spin"
                  role="status"
                  aria-label={t("Loading notes…")}
                />
              ) : (
                <File size={20} aria-hidden="true" />
              )}
            </header>
            <div className="mobile-notes-search">
              <Search size={20} aria-hidden="true" />
              <input data-ui="input"
                aria-label={t("Filter notes")}
                placeholder={t("Filter notes")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <IconButton
                className="mobile-sheet-header-button"
                label={t("Refresh notes")}
                disabled={loading || topics.loading || working || !visible}
                onClick={() => { void refresh(); topics.refresh(); }}
              >
                <RefreshCw size={18} />
              </IconButton>
            </div>
            <div className="mobile-notes-scroll" data-mobile-page-scroll>
              {error && (
                <p role="alert" className="mobile-notes-error">
                  {error}{" "}
                  <button onClick={() => void refresh()}>{t("Retry")}</button>
                </p>
              )}
              {loading && !notes.length ? (
                <p className="mobile-notes-empty" role="status">
                  <MobileSpinner
                    size={24}
                    className="mobile-spin"
                    aria-label={t("Loading notes…")}
                  />
                </p>
              ) : !filtered.length && !filteredTopics.length && !topics.loading ? (
                <MobileEmpty icon={needle ? <Search size={40} /> : <File size={40} />}
                  title={t(needle ? "No matching notes" : "Notes")}>
                  {!needle && t("No notes yet. Create notes on desktop to view them here.")}
                </MobileEmpty>
              ) : (
                <ul className="mobile-notes-list">
                  {filtered.map((note) => (
                    <li key={note.id}>
                      <button
                        className="mobile-note-card"
                        disabled={working || loading || !visible}
                        onClick={() => void open(note.id)}
                      >
                        <span className="mobile-note-meta">
                          <span>{noteSourceProject(note.sourceCwd)}</span>
                          <time
                            dateTime={new Date(note.updatedAt).toISOString()}
                          >
                            {formatMobileRelativeTime(
                              note.updatedAt,
                              Date.now(),
                              language,
                            )}
                          </time>
                        </span>
                        <strong>{note.title}</strong>
                        <span className="mobile-note-preview">
                          {notePreview(note.body, note.title)}
                        </span>
                        {!!note.tags.length && (
                          <span className="mobile-note-tags">
                            {note.tags.map((tag) => (
                              <span key={tag}>#{tag}</span>
                            ))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <section aria-label={t("Assistant memory")}>
                <h2 className="mobile-notes-section-title">{t("Assistant memory")}</h2>
                {topics.loading && <p className="mobile-notes-empty" role="status">{t("Loading notes…")}</p>}
                {topics.errors.map(({ source, error }) => (
                  <p key={source.key} role="alert" className="mobile-notes-error">
                    {source.name}: {error} <button disabled={!visible} onClick={topics.refresh}>{t("Retry")}</button>
                  </p>
                ))}
                {!topics.loading && !topics.errors.length && !filteredTopics.length && (
                  <MobileEmpty icon={<File size={40} />} title={t(needle ? "No matching notes" : "Assistant memory")}>
                    {!needle && t("No topic notes yet.")}
                  </MobileEmpty>
                )}
                <ul className="mobile-notes-list">
                  {filteredTopics.map((note) => (
                    <li key={note.key}>
                      <button className="mobile-note-card" data-assistant-topic disabled={working || !visible} onClick={() => setSelectedTopicKey(note.key)}>
                        <span className="mobile-note-meta">{note.source.name}</span>
                        <strong>{note.name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </MobilePageTransition>
    </aside>
  );
}

function MobileNoteViewer({
  ref,
  api,
  note,
  projects,
  onBack,
  onAddToChat,
}: {
  ref?: Ref<MobileNotesHandle>;
  api: NotesApi;
  note: Note;
  projects: HostProject[];
  onBack: () => void;
  onAddToChat: (note: Note) => Promise<void>;
}) {
  const { language, t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const operation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const back = () => {
    if (!operation.current && visible) onBack();
  };
  useImperativeHandle(ref, () => ({ back }));
  const addToChat = async () => {
    if (operation.current || !visible) return;
    operation.current = true;
    setWorking(true);
    setActionError("");
    try {
      await onAddToChat(note);
    } catch (problem) {
      if (mounted.current) setActionError(errorMessage(problem));
    } finally {
      operation.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  const platform = useMemo(
    () => ({ ...mobileTranscriptPlatform, resolveNoteImage: api.resolveImage }),
    [api],
  );
  const sourceProject = noteSourceProject(note.sourceCwd);
  const projectName = sourceProject
    ? (projects.find((project) => project.cwd === note.sourceCwd)?.name ??
      sourceProject)
    : t("No project");
  const blocked = working || !visible;
  return (
    <>
      <header className="mobile-notes-header">
        <IconButton
          className="mobile-sheet-header-button"
          label={t("Back")}
          disabled={blocked}
          onClick={back}
        >
          <ArrowLeft size={24} />
        </IconButton>
        <h1>{t("Note")}</h1>
        <File size={20} aria-hidden="true" />
      </header>
      <div
        className="mobile-notes-scroll mobile-note-viewer"
        data-mobile-page-scroll
      >
        <div className="mobile-note-meta">
          <span>{note.slug}</span>
          <span title={note.sourceCwd}>{projectName}</span>
        </div>
        <h2 className="mobile-note-title">{note.title}</h2>
        <p className="mobile-muted">
          {t("Updated ")}
          {formatMobileRelativeTime(note.updatedAt, Date.now(), language)}
        </p>
        {!!note.tags.length && (
          <div className="mobile-note-tags">
            {note.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        )}
        <div className="mobile-note-actions">
          <Button variant="primary"

            disabled={blocked || !note.body.trim()}
            onClick={() => void addToChat()}
          >
            {t("Add to chat")}
          </Button>
        </div>
        {!!actionError && (
          <p role="alert" className="mobile-notes-error">
            {actionError}
          </p>
        )}
        <TranscriptPlatformContext.Provider value={platform}>
          <div className="mobile-note-markdown">
            {note.body.trim() ? (
              <AgentMarkdown text={note.body} cwd={note.sourceCwd} hardBreaks />
            ) : (
              <p className="mobile-muted">{t("No description")}</p>
            )}
          </div>
        </TranscriptPlatformContext.Provider>
      </div>
    </>
  );
}
