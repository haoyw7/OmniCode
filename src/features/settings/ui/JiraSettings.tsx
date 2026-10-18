import { useMaskEmails } from "../model/displayPrefs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../../../shared/ui/forms/Button";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { clearInboxCache } from "../../inbox/model/githubTasks";
import {
  disconnectJira,
  JIRA_CHANGE_EVENT,
  jiraConnected,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  notifyJiraChange,
  saveHiddenJiraProjectIds,
  saveJiraConfig,
  type JiraProject,
  type JiraStatus,
} from "../../inbox/model/jira";

export function JiraSettings() {
  const masked = useMaskEmails();
  const { t: uiT } = useTranslation();
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [hiddenIds, setHiddenIds] = useState(loadHiddenJiraProjectIds);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await listJiraProjects());
    } catch (err) {
      setProjects([]);
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void jiraConnected()
      .then(async (next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.connected) await loadProjects();
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    const onChange = () => setHiddenIds(loadHiddenJiraProjectIds());
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
    };
  }, [loadProjects]);

  const connect = async () => {
    if (busy || checking || !site.trim() || !email.trim() || !token.trim())
      return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await withStatusToast(() => saveJiraConfig({ site, email, token }), {
          loading: uiT("Connecting to {service}…", { service: "Jira" }),
          success: uiT("Connected to {service}", { service: "Jira" }),
          error: false,
        }),
      );
      setToken("");
      clearInboxCache();
      saveHiddenJiraProjectIds([]);
      await loadProjects();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await withStatusToast(() => disconnectJira(), {
          loading: uiT("Disconnecting from {service}…", { service: "Jira" }),
          success: uiT("Disconnected from {service}", { service: "Jira" }),
          error: false,
        }),
      );
      setProjects([]);
      setToken("");
      clearInboxCache();
      notifyJiraChange();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3.5">
      {checking ? (
        <p className="text-[12px] text-content/45">
          {uiT("Checking Jira connection…")}
        </p>
      ) : status?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[12px] text-content/65">
            <p className="break-all">{status.site}</p>
            <p className="flex min-w-0">
              <PrivateEmail masked={masked} key={status.email} email={status.email} />
            </p>
          </div>
          <Button variant="secondary" onClick={() => void disconnect()} disabled={busy}>
            {busy ? uiT("Disconnecting") : uiT("Disconnect")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-[12px] leading-relaxed text-content/45">
            {uiT(
              "Connect your Jira Cloud site using your Atlassian email and an API token without scopes. Disconnect deletes the saved credentials.",
            )}
          </p>
          {(
            [
              {
                label: uiT("Jira site"),
                value: site,
                set: setSite,
                type: "text",
                placeholder: "yourteam.atlassian.net",
              },
              {
                label: uiT("Atlassian email"),
                value: email,
                set: setEmail,
                type: "email",
                placeholder: "you@example.com",
              },
              {
                label: uiT("Jira API token"),
                value: token,
                set: setToken,
                type: "password",
                placeholder: "API token",
              },
            ] as const
          ).map((field) => (
            <label
              key={field.label}
              className="flex flex-col gap-1 text-[12px] text-content/65"
            >
              {field.label}
              <input data-ui="input"
                aria-label={field.label}
                type={field.type}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                disabled={busy}
                required
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-content outline-none focus:border-content/20"
              />
            </label>
          ))}
          <div className="flex items-center gap-3">
            <Button variant="secondary"
              type="submit"
              disabled={busy || !site.trim() || !email.trim() || !token.trim()}
            >
              {busy ? uiT("Connecting") : uiT("Connect")}
            </Button>
            <button
              type="button"
              onClick={() =>
                void openUrl(
                  "https://id.atlassian.com/manage-profile/security/api-tokens",
                )
              }
              className="text-[12px] text-content/65 hover:text-content"
            >
              {uiT("Create API token")}
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-[12px] text-red-400/90">
          {error}
        </p>
      ) : null}
      {status?.connected ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-content">
              {uiT("Projects")}
            </span>
            <Button variant="secondary"
              disabled={busy || checking}
              onClick={() => void loadProjects()}
            >
              {uiT("Refresh projects")}
            </Button>
          </div>
          <p className="text-[12px] text-content/45">
            {uiT("Unchecked projects stay out of the inbox.")}
          </p>
          {projects.map((project) => (
            <label
              key={project.id}
              className="flex items-center gap-2 text-[13px] text-content"
            >
              <input data-ui="checkbox"
                type="checkbox"
                checked={!hiddenIds.includes(project.id)}
                disabled={busy}
                onChange={() => {
                  const next = hiddenIds.includes(project.id)
                    ? hiddenIds.filter((id) => id !== project.id)
                    : [...hiddenIds, project.id];
                  clearInboxCache();
                  saveHiddenJiraProjectIds(next);
                }}
              />
              {project.name}{" "}
              <span className="text-content/40">{project.key}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
