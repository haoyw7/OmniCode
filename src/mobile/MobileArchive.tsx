import { useEffect, useState } from "react";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { SessionWorktreeIcon } from "../features/sessions/ui/SessionWorktreeIcon";
import { translate } from "../shared/i18n/language";
import { useTranslation } from "../shared/i18n/useTranslation";
import { formatMobileRelativeTime } from "./relativeTime";
import { archivedMobileSessions } from "./sessionList";
import { Archive } from "../shared/ui/icons";
import { MobileEmpty } from "./MobileEmpty";

type ArchiveGroup = { project: HostProject; sessions: HostSessionSummary[] };

/** Archived conversations across every project, restorable one at a time. */
export function MobileArchive({
  projects,
  disabled,
  loadSessions,
  onRestore,
}: {
  projects: readonly HostProject[];
  disabled: boolean;
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  onRestore: (session: HostSessionSummary) => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const [groups, setGroups] = useState<ArchiveGroup[]>();
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState<string>();

  useEffect(() => {
    let live = true;
    setError("");
    void Promise.all(
      projects
        .filter((project) => project.kind !== "assistant")
        .map(async (project) => ({
          project,
          sessions: archivedMobileSessions(await loadSessions(project.id)),
        })),
    )
      .then((items) => {
        if (live) setGroups(items.filter((item) => item.sessions.length));
      })
      .catch(() => {
        if (live) {
          setGroups([]);
          setError(translate("Unable to load archived conversations."));
        }
      });
    return () => {
      live = false;
    };
  }, [projects, loadSessions]);

  const restore = async (session: HostSessionSummary) => {
    setRestoring(session.id);
    setError("");
    try {
      await onRestore(session);
      setGroups((items) =>
        items
          ?.map((item) => ({
            ...item,
            sessions: item.sessions.filter((entry) => entry.id !== session.id),
          }))
          .filter((item) => item.sessions.length),
      );
    } catch {
      setError(t("Unable to restore the conversation."));
    } finally {
      setRestoring(undefined);
    }
  };

  if (!groups)
    return <p className="mobile-settings-footer">{t("Loading…")}</p>;
  const now = Date.now();
  return (
    <>
      {error ? (
        <p className="mobile-form-error mobile-settings-note" role="status">
          {error}
        </p>
      ) : null}
      {groups.length === 0 && !error ? (
        <MobileEmpty icon={<Archive size={40} />} title={t("No archived conversations")} />
      ) : null}
      {groups.map(({ project, sessions }) => (
        <section
          key={project.id}
          className="mobile-settings-group"
          aria-label={project.name}
        >
          <h2>{project.name}</h2>
          <div className="mobile-settings-card">
            {sessions.map((session) => (
              <div key={session.id} className="mobile-settings-row">
                <span className="mobile-settings-icon">
                  <HarnessIcon harness={session.harness} className="size-6" />
                </span>
                <span className="mobile-settings-label">
                  <span className="mobile-archive-title">
                    <span className="min-w-0 truncate">
                      {sessionDisplayTitle(session.title, session.harness) ||
                        t("Untitled")}
                    </span>
                    <SessionWorktreeIcon session={session} />
                  </span>
                  <small>
                    {formatMobileRelativeTime(session.updatedAt, now, language)}
                  </small>
                </span>
                <button
                  type="button"
                  className="mobile-settings-action mobile-archive-restore"
                  aria-label={t("Restore {title}", {
                    title:
                      sessionDisplayTitle(session.title, session.harness) ||
                      t("Untitled"),
                  })}
                  disabled={disabled || restoring !== undefined}
                  onClick={() => void restore(session)}
                >
                  {t("Restore")}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
