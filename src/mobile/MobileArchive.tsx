import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { mobileArchiveQuery } from "./mobileQueries";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { SessionWorktreeIcon } from "../features/sessions/ui/SessionWorktreeIcon";
import { useTranslation } from "../shared/i18n/useTranslation";
import { formatMobileRelativeTime } from "./relativeTime";
import { Archive } from "../shared/ui/icons";
import { MobileEmpty } from "./MobileEmpty";


/** Archived conversations across every project, restorable one at a time. */
export function MobileArchive({
  hostKey,
  projects,
  disabled,
  loadSessions,
  onRestore,
}: {
  hostKey?: string;
  projects: readonly HostProject[];
  disabled: boolean;
  loadSessions: (projectId: string) => Promise<HostSessionSummary[]>;
  onRestore: (session: HostSessionSummary) => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const options = mobileArchiveQuery(hostKey, projects, loadSessions);
  const query = useQuery(options, queryClient);
  const groups = query.data ?? [];
  const mutation = useMutation({
    mutationFn: (session: HostSessionSummary) => onRestore(session),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: options.queryKey });
      return { queryKey: options.queryKey };
    },
    onSuccess: (_result, session, context) => {
      queryClient.setQueryData(context.queryKey, current => current?.map(group => ({
        ...group, sessions: group.sessions.filter(entry => entry.id !== session.id),
      })).filter(group => group.sessions.length));
    },
  }, queryClient);
  const restoring = mutation.isPending ? mutation.variables?.id : undefined;
  const error = mutation.isError ? t("Unable to restore the conversation.")
    : query.isError ? t("Unable to load archived conversations.") : "";
  const restore = (session: HostSessionSummary) => mutation.mutate(session);
  if (query.isPending) return <p className="mobile-settings-footer">{t("Loading…")}</p>;
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
