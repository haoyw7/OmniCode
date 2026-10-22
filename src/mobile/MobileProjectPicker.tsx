import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../shared/ui/primitives/Field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { withToast } from "../shared/ui/primitives/Sonner";
import { mobileSourceKey } from "./mobileQueries";
import { Button } from "../shared/ui/forms/Button";
import { IconButton } from "../shared/ui/forms/IconButton";
import {
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
  const form = useForm({ resolver: zodResolver(z.object({ path: z.string().trim().min(1, t("Enter a folder path")) })), defaultValues: { path: "" } });
  const path = useWatch({ control: form.control, name: "path" });
  const setPath = (value: string) => form.setValue("path", value, { shouldValidate: form.formState.isSubmitted });
  const [filter, setFilter] = useState("");
  const [requested, setRequested] = useState<{ path?: string } | null>({});
  const [sessionActive, setSessionActive] = useState(isOpen);
  useEffect(() => { if (isOpen) setSessionActive(true); }, [isOpen]);
  const read = useQuery({
    queryKey: ["mobile", "browse", mobileSourceKey(browseDirectories), requested?.path ?? null],
    enabled: sessionActive && requested !== null,
    queryFn: ({ signal }) => { signal.throwIfAborted(); return browseDirectories(requested?.path); },
  }, queryClient);
  const mutation = useMutation({ mutationFn: (path: string) => withToast(() => onOpen(path),
    { loading: t("Opening…"), success: false }) }, queryClient);
  const directory = requested ? read.data : undefined;
  const parent = directory?.parent ?? directoryParent(path);
  const loading = requested !== null && read.isFetching, opening = mutation.isPending;
  const browseFailed = requested !== null && read.isError;
  const problem = mutation.error ?? (browseFailed ? read.error : null);
  const error: PickerError | undefined = problem ? problem instanceof Error ? { message: problem.message } : { key: mutation.error ? "Unable to open this project." : "Unable to browse folders." } : undefined;
  const inFlight = useRef(false);
  const folders = useRef<HTMLDivElement>(null);
  const blocked = disabled || opening;
  const browse = (next?: string) => {
    mutation.reset(); setPath(next ?? ""); setFilter("");
    if (requested && requested.path === next) void read.refetch();
    else setRequested({ path: next });
  };
  useEffect(() => {
    if (requested && read.data) setPath(read.data.path);
  }, [requested, read.data]);
  useEffect(() => {
    if (folders.current) folders.current.scrollTop = 0;
  }, [directory?.path, filter]);
  const close = () => { if (!blocked && !inFlight.current) onClose(); };
  const open = form.handleSubmit(async ({ path }) => {
    if (blocked || loading || !path.trim() || inFlight.current) return;
    inFlight.current = true;
    try { await mutation.mutateAsync(path.trim()); }
    catch { /* Keep the draft and expose the mutation failure. */ }
    finally { inFlight.current = false; }
  });
  const query = filter.trim().toLocaleLowerCase();
  const entries = directory?.entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(query),
  );

  return (
    <MobileSheet open={isOpen} title="Open project" anchor={anchor} onClose={close}
      onExited={() => {
        setSessionActive(false);
        setRequested({});
        mutation.reset();
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
              <X />
            </IconButton>
          </header>
          <div className="mobile-project-picker-navigation">
            <Button variant="secondary"
              type="button"

              disabled={blocked}
              onClick={() => void browse()}
            >
              <Computer />
              <span>{t("Home folder")}</span>
            </Button>
            <Button variant="secondary"
              type="button"

              disabled={blocked || !parent}
              onClick={() => {
                if (parent) void browse(parent);
              }}
            >
              <ArrowUp />
              <span>{t("Parent folder")}</span>
            </Button>
          </div>
          <form
            className="mobile-project-picker-path"
            noValidate onSubmit={form.handleSubmit(({ path }) => { if (!blocked && !loading) browse(path); })}
          >
            <input data-ui="input"
              aria-label={t("Folder path")}
              placeholder={t("Folder path")}
              value={path}
              aria-invalid={!!form.formState.errors.path}
              onChange={(event) => {
                // Typing wins over a directory response still in transit.
                setRequested(null);
                setPath(event.currentTarget.value);
                setFilter("");
                mutation.reset();
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
              <ChevronRight />
            </Button>
            <FieldError errors={[form.formState.errors.path]} />
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
                  className="hover:opacity-80 active:opacity-70 mobile-sheet-row"
                  disabled={blocked}
                  title={entry.path}
                  onClick={() => void browse(entry.path)}
                >
                  <Folder />
                  <span className="mobile-project-picker-folder-name">
                    {entry.name}
                  </span>
                  <ChevronRight />
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
                  onClick={() => void browse(requested?.path)}
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
