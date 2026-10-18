import { Button } from "../shared/ui/forms/Button";
import { IconButton } from "../shared/ui/forms/IconButton";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { HostDirectory } from "../features/connections/model/protocol";
import { ArrowUp, ChevronRight, Computer, Folder, X } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { parentPath, pathKey } from "../shared/lib/paths";
import { MobileSheet } from "./MobileSheet";

type PickerError =
  | { message: string }
  | { key: "Unable to browse folders." | "Unable to open this project." };

/** Navigation must still work when the Host cannot read the requested folder. */
function directoryParent(path?: string): string | null {
  if (!path) return null;
  const parent = parentPath(path);
  return pathKey(parent) === pathKey(path) ? null : parent;
}

/** Browse the connected computer's folders before registering a project. */
export function MobileProjectPicker({
  open: isOpen = true,
  onExited,
  hostName,
  anchor,
  disabled,
  browseDirectories,
  onOpen,
  onClose,
}: {
  open?: boolean;
  onExited?: () => void;
  hostName: string;
  anchor: RefObject<HTMLElement | null>;
  disabled: boolean;
  browseDirectories: (path?: string) => Promise<HostDirectory>;
  onOpen: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState<HostDirectory>();
  const [parent, setParent] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<PickerError>();
  const [browseFailed, setBrowseFailed] = useState(false);
  const requestVersion = useRef(0);
  const started = useRef(false);
  const requestedPath = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const folders = useRef<HTMLDivElement>(null);
  const blocked = disabled || opening;

  const browse = useCallback(
    async (next?: string) => {
      const version = ++requestVersion.current;
      requestedPath.current = next;
      setPath(next ?? "");
      setParent(directoryParent(next));
      setDirectory(undefined);
      setFilter("");
      setLoading(true);
      setError(undefined);
      setBrowseFailed(false);
      try {
        const value = await browseDirectories(next);
        if (version !== requestVersion.current) return;
        setDirectory(value);
        setParent(value.parent);
        setPath(value.path);
      } catch (problem) {
        if (version !== requestVersion.current) return;
        setBrowseFailed(true);
        setError(
          problem instanceof Error
            ? { message: problem.message }
            : { key: "Unable to browse folders." },
        );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [browseDirectories],
  );

  useEffect(() => {
    if (!isOpen || started.current) return;
    started.current = true;
    void browse();
  }, [isOpen, browse]);
  useEffect(() => () => {
    requestVersion.current++;
    started.current = false;
  }, []);
  useEffect(() => {
    if (folders.current) folders.current.scrollTop = 0;
  }, [directory?.path, filter]);

  const close = () => {
    if (blocked || inFlight.current) return;
    onClose();
  };
  const open = async () => {
    if (blocked || loading || !path.trim() || inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setError(undefined);
    setBrowseFailed(false);
    const version = ++requestVersion.current;
    try {
      await onOpen(path.trim());
    } catch (problem) {
      if (version === requestVersion.current)
        setError(
          problem instanceof Error
            ? { message: problem.message }
            : { key: "Unable to open this project." },
        );
    } finally {
      inFlight.current = false;
      if (version === requestVersion.current) setOpening(false);
    }
  };
  const query = filter.trim().toLocaleLowerCase();
  const entries = directory?.entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(query),
  );

  return (
    <MobileSheet open={isOpen} title="Open project" anchor={anchor} onClose={close}
      onExited={() => {
        requestVersion.current++;
        started.current = false;
        setOpening(false);
        onExited?.();
      }}>
      <div className="mobile-project-picker">
        <div className="mobile-project-picker-body">
          <header className="mobile-project-picker-heading">
            <div>
              <h2>{t("Open project")}</h2>
              <p className="mobile-muted">
                {t("Browse folders on {host}.", { host: hostName })}
              </p>
            </div>
            <IconButton
              type="button"

              label={t("Cancel")}
              disabled={blocked}
              onClick={close}
            >
              <X size={20} />
            </IconButton>
          </header>
          <div className="mobile-project-picker-navigation">
            <Button variant="secondary"
              type="button"

              disabled={blocked}
              onClick={() => void browse()}
            >
              <Computer size={18} />
              <span>{t("Home folder")}</span>
            </Button>
            <Button variant="secondary"
              type="button"

              disabled={blocked || !parent}
              onClick={() => {
                if (parent) void browse(parent);
              }}
            >
              <ArrowUp size={18} />
              <span>{t("Parent folder")}</span>
            </Button>
          </div>
          <form
            className="mobile-project-picker-path"
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocked && path.trim()) void browse(path.trim());
            }}
          >
            <input data-ui="input"
              aria-label={t("Folder path")}
              placeholder={t("Folder path")}
              value={path}
              onChange={(event) => {
                // Typing wins over a directory response still in transit.
                requestVersion.current++;
                setPath(event.currentTarget.value);
                setParent(directoryParent(event.currentTarget.value.trim()));
                setDirectory(undefined);
                setLoading(false);
                setFilter("");
                setError(undefined);
                setBrowseFailed(false);
              }}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={blocked}
            />
            <Button variant="secondary"
              type="submit"

              aria-label={t("Go to folder")}
              title={t("Go to folder")}
              disabled={blocked || loading || !path.trim()}
            >
              <ChevronRight size={20} />
            </Button>
          </form>
          <input data-ui="input"
            type="search"
            aria-label={t("Filter folders")}
            placeholder={t("Filter folders")}
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={blocked || loading || !directory}
          />
          <div
            ref={folders}
            className="mobile-project-picker-folders"
            role="region"
            aria-label={t("Folders")}
            aria-busy={loading}
          >
            {loading ? (
              <p className="mobile-muted" role="status">
                {t("Loading folders…")}
              </p>
            ) : entries?.length ? (
              entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="mobile-sheet-row"
                  disabled={blocked}
                  title={entry.path}
                  onClick={() => void browse(entry.path)}
                >
                  <Folder size={20} />
                  <span className="mobile-project-picker-folder-name">
                    {entry.name}
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))
            ) : directory ? (
              <p className="mobile-muted" role="status">
                {t(query ? "No matching folders" : "No subfolders")}
              </p>
            ) : !error ? (
              <p className="mobile-muted">
                {t("Browse a folder to see its subfolders.")}
              </p>
            ) : null}
          </div>
          {error && (
            <div className="mobile-project-picker-error">
              <p className="mobile-form-error" role="alert">
                {"key" in error ? t(error.key) : error.message}
              </p>
              {browseFailed && (
                <Button variant="secondary"
                  type="button"

                  disabled={blocked || loading}
                  onClick={() => void browse(requestedPath.current)}
                >
                  {t("Retry")}
                </Button>
              )}
            </div>
          )}
        </div>
        <Button variant="primary"
          type="button"
          className="mobile-project-picker-open"
          disabled={blocked || loading || !path.trim()}
          onClick={() => void open()}
        >
          {t(opening ? "Opening…" : "Open project")}
        </Button>
      </div>
    </MobileSheet>
  );
}
