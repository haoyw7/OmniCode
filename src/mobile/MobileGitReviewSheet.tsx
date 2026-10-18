import { IconButton } from "../shared/ui/forms/IconButton";
import { motion } from "motion/react";
import { motionGeometry, panelTransition } from "../shared/motion/tokens";
import { useEffect, useId, useRef, useState } from "react";
import type { GitChangedFile, GitFileDiff } from "../platform/tauri/fs";
import { useTranslation } from "../shared/i18n/useTranslation";
import { pathKey, resolveWorkspacePath } from "../shared/lib/paths";
import { ChevronRight, LoaderCircle, WrapText } from "../shared/ui/icons";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import type { MobileGitSource } from "./mobileGit";
import type { MobileGitIndexState } from "./useMobileGitIndex";
import type { SessionChangesIndex } from "./mobileSessionChanges";
import { MobileSheet } from "./MobileSheet";
import { MobileGitDiff } from "./MobileGitDiff";
import "./styles/git-review.css";
import { MobileDiffCounts } from "./MobileDiffCounts";

/** Keep or undo the edits one conversation made. */
const MotionChevronRight = motion.create(ChevronRight);

export type MobileSessionChangeActions = {
  /** The conversation is still writing; both actions wait for it. */
  busy: boolean;
  keep: () => Promise<void>;
  undo: () => Promise<void>;
};

/** HEAD → working-copy review, or one conversation's own edits with Keep and
 * Undo, expanded directly in the file list. */
export function MobileGitReviewSheet({
  open,
  onExited,
  source,
  state,
  enabled,
  path,
  cwd,
  session,
  onBack,
  onClose,
}: {
  open: boolean;
  onExited: () => void;
  source: MobileGitSource;
  state: MobileGitIndexState;
  enabled: boolean;
  /** Limit a file-specific review to this path and open its diff immediately. */
  path?: string;
  cwd?: string;
  session?: MobileSessionChangeActions;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sheetTitle = session ? "Session changes" : "Uncommitted changes";
  const [wrap, setWrap] = useState(false);
  const selectedPath = path ? pathKey(resolveWorkspacePath(path, cwd) ?? path) : undefined;
  const files = selectedPath
    ? state.index?.files.filter((file) =>
        pathKey(resolveWorkspacePath(file.path, cwd) ?? file.path) === selectedPath)
    : state.index?.files;
  const counts = path
    ? files?.reduce((total, file) => ({
        additions: total.additions + file.additions,
        deletions: total.deletions + file.deletions,
      }), { additions: 0, deletions: 0 })
    : state.index;
  const title = state.index
    ? t(files?.length === 1 ? "{count} file changed" : "{count} files changed", {
        count: files?.length ?? 0,
      })
    : t(sheetTitle);
  return (
    <MobileSheet
      open={open}
      onExited={onExited}
      title={sheetTitle}
      header={{ title, action: (
        <IconButton
          type="button"
          className="mobile-sheet-header-button mobile-git-wrap"
          label={t("Wrap lines")}
          title={t("Wrap lines")}
          aria-pressed={wrap}
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText size={22} />
        </IconButton>
      ) }}
      surface="solid"
      detents
      onBack={onBack}
      onClose={onClose}
    >
      <div className="mobile-git-review">
        <div className="mobile-git-toolbar">
          <span>
            {counts && (
              <MobileDiffCounts
                additions={counts.additions}
                deletions={counts.deletions}
              />
            )}
          </span>
          {session && !path && !!files?.length && (
            <SessionChangeButtons
              actions={session}
              enabled={enabled}
              undoBlocked={(state.index as SessionChangesIndex | null)?.undoBlocked}
              onDone={state.refresh}
            />
          )}
        </div>
        {!enabled && (
          <p className="mobile-git-note">
            {t("Reconnect to refresh changes.")}
          </p>
        )}
        {session && (state.index as SessionChangesIndex | null)?.workspaceShared && (
          <p className="mobile-git-note">
            {t("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")}
          </p>
        )}
        {state.error && (
          <div className="mobile-git-error" role="alert">
            <strong>{t("Could not load changes.")}</strong>
            <p>{state.error}</p>
          </div>
        )}
        {!state.index && state.loading && (
          <p className="mobile-git-note" role="status">
            {t("Loading changes…")}
          </p>
        )}
        {files?.length === 0 && (
          <p className="mobile-git-note">{t("No file changes")}</p>
        )}
        {files?.map((file) => (
          <MobileGitFileRow
            key={`${path ?? ""}:${file.relative}`}
            source={source}
            entry={file}
            enabled={enabled}
            wrap={wrap}
            initiallyExpanded={!!path}
          />
        ))}
      </div>
    </MobileSheet>
  );
}

function SessionChangeButtons({
  actions,
  enabled,
  undoBlocked,
  onDone,
}: {
  actions: MobileSessionChangeActions;
  enabled: boolean;
  undoBlocked?: SessionChangesIndex["undoBlocked"];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [acting, setActing] = useState<"keep" | "undo">();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const disabled = !enabled || actions.busy || !!acting;
  const run = (action: "keep" | "undo") => {
    clearTimeout(timer.current);
    setConfirming(false);
    setActing(action);
    setError(undefined);
    void actions[action]()
      .catch((problem) => setError(problem instanceof Error ? problem.message : String(problem)))
      .finally(() => {
        setActing(undefined);
        onDone();
      });
  };
  const undoTitle = actions.busy
    ? t("Keep and undo are unavailable while the session is running")
    : undoBlocked === "shared"
      ? t("Other sessions were active in this workspace. These changes may include their edits; undo is disabled.")
      : undoBlocked === "locked"
        ? t("Undo is unavailable while another session is running in this project")
        : undoBlocked === "outside"
          ? t("Undo is unavailable because a file changed outside this session")
          : t("Undo all session changes");
  return (
    <>
      <span className="mobile-git-actions">
        <button
          type="button"
          className="mobile-git-action"
          data-confirming={confirming || undefined}
          title={undoTitle}
          aria-label={confirming ? t("Confirm undo") : undoTitle}
          disabled={disabled || !!undoBlocked}
          onClick={() => {
            // A stray tap must not discard the agent's work.
            if (!confirming) {
              setConfirming(true);
              timer.current = setTimeout(() => setConfirming(false), 4_000);
              return;
            }
            run("undo");
          }}
        >
          {t(confirming ? "Confirm undo" : "Undo")}
        </button>
        <button
          type="button"
          className="mobile-git-action"
          title={actions.busy
            ? t("Keep and undo are unavailable while the session is running")
            : t("Keep all session changes and dismiss this card")}
          disabled={disabled}
          onClick={() => run("keep")}
        >
          {t("Keep")}
        </button>
      </span>
      {error && (
        // Host refusals reuse the desktop card's localized explanations.
        <p className="mobile-git-action-error" role="alert">{t(error)}</p>
      )}
    </>
  );
}

function MobileGitFileRow({
  source,
  entry,
  enabled,
  wrap,
  initiallyExpanded,
}: {
  source: MobileGitSource;
  entry: GitChangedFile;
  enabled: boolean;
  wrap: boolean;
  initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [ready, setReady] = useState(false);
  const visible = useSurfaceVisibility();
  const contentId = useId();
  return (
    <div className="mobile-git-file-entry">
      <button
        type="button"
        className="mobile-git-file-row"
        disabled={!enabled && !expanded}
        aria-expanded={expanded}
        aria-busy={expanded && enabled && !ready || undefined}
        aria-controls={contentId}
        title={entry.relative}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded && enabled && !ready ? (
          <LoaderCircle size={16} aria-hidden="true" className="mobile-git-file-chevron motion-safe:animate-spin" />
        ) : (
          <MotionChevronRight size={16} aria-hidden="true" className="mobile-git-file-chevron" animate={{ rotate: expanded ? motionGeometry.disclosureAngle : 0 }} transition={panelTransition} />
        )}
        <span className="mobile-git-file-path"><bdi dir="ltr">{entry.relative}</bdi></span>
        <MobileDiffCounts
          additions={entry.additions}
          deletions={entry.deletions}
        />
      </button>
      <AnimatedCollapse expanded={expanded} ready={ready} motion="height">
        <div id={contentId} className="mobile-git-file">
          <MobileGitFile source={source} entry={entry} enabled={enabled} wrap={wrap} active={expanded && visible} onReady={setReady} />
        </div>
      </AnimatedCollapse>
    </div>
  );
}

function MobileGitFile({
  source,
  entry,
  enabled,
  wrap,
  active,
  onReady,
}: {
  source: MobileGitSource;
  entry: GitChangedFile;
  enabled: boolean;
  wrap: boolean;
  active: boolean;
  onReady: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => () => onReady(false), [onReady]);
  const [loaded, setLoaded] = useState<{
    source: MobileGitSource;
    diff?: GitFileDiff;
    error?: string;
  }>({ source });
  useEffect(() => {
    if (!active || !enabled) return;
    let current = true;
    setLoaded((previous) => ({
      source,
      diff: previous.source === source ? previous.diff : undefined,
    }));
    void source
      .loadDiff(entry.relative)
      .then((diff) => {
        if (current) setLoaded({ source, diff });
      })
      .catch((problem) => {
        if (current)
          setLoaded({
            source,
            error: problem instanceof Error ? problem.message : String(problem),
          });
      });
    return () => {
      current = false;
    };
  }, [source, entry.relative, active, enabled]);
  useEffect(() => {
    if (loaded.source === source && loaded.error) onReady(true);
  }, [loaded, source, onReady]);
  const diff = loaded.source === source ? loaded.diff : undefined;
  return (
    <>
      {loaded.error && (
        <div className="mobile-git-error" role="alert">
          <strong>{t("Could not load diff.")}</strong>
          <p>{loaded.error}</p>
        </div>
      )}
      {diff && <MobileGitDiff diff={diff} wrap={wrap} onReady={onReady} />}
    </>
  );
}
