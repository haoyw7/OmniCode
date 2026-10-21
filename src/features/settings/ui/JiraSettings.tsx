import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { jiraIntegrationQuery } from "../model/inboxIntegrationQueries";
import { jiraProjectsQuery, inboxKeys } from "../../inbox/model/inboxQueries";
import { useMaskEmails } from "../model/displayPrefs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../../../shared/ui/forms/Button";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { clearInboxCache } from "../../inbox/model/githubTasks";
import {
  disconnectJira,
  JIRA_CHANGE_EVENT,
  loadHiddenJiraProjectIds,
  notifyJiraChange,
  saveHiddenJiraProjectIds,
  saveJiraConfig,
} from "../../inbox/model/jira";

export function JiraSettings() {
  const masked = useMaskEmails();
  const { t: uiT } = useTranslation();
  const statusQuery = useQuery(jiraIntegrationQuery(), queryClient);
  const status = statusQuery.data;
  const schema = z.object({
    site: z.string().trim().min(1, uiT("This field is required")),
    email: z.string().trim().pipe(z.email({ pattern: z.regexes.html5Email, error: uiT("Enter a valid email address") })),
    token: z.string().trim().min(1, uiT("This field is required")),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { site: "", email: "", token: "" } });
  const [site, email, token] = useWatch({ control: form.control, name: ["site", "email", "token"] });
  const projectQuery = useQuery({ ...jiraProjectsQuery(), enabled: !!status?.connected }, queryClient);
  const projects = status?.connected ? projectQuery.data ?? [] : [];
  const checking = statusQuery.isFetching;
  const [hiddenIds, setHiddenIds] = useState(loadHiddenJiraProjectIds);
  useEffect(() => {
    const onChange = () => setHiddenIds(loadHiddenJiraProjectIds());
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
  }, []);
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema> | null) => withToast(
      () => values ? saveJiraConfig(values) : disconnectJira(), {
        loading: uiT(values ? "Connecting to {service}…" : "Disconnecting from {service}…", { service: "Jira" }),
        success: uiT(values ? "Connected to {service}" : "Disconnected from {service}", { service: "Jira" }),
      }),
    onSuccess: async (next, values) => {
      await queryClient.cancelQueries({ queryKey: jiraIntegrationQuery().queryKey });
      queryClient.setQueryData(jiraIntegrationQuery().queryKey, next);
      form.resetField("token");
      clearInboxCache();
      if (values) saveHiddenJiraProjectIds([]);
      else { queryClient.setQueryData(jiraProjectsQuery().queryKey, []); notifyJiraChange(); }
      await Promise.all([invalidateAfterChange(inboxKeys.connections), invalidateAfterChange(inboxKeys.lists)]);
    },
  }, queryClient);
  const busy = mutation.isPending;
  const error = errorMessage(mutation.error ?? statusQuery.error ?? (status?.connected ? projectQuery.error : null));
  const connect = form.handleSubmit((values) => {
    if (!busy && !checking) mutation.mutate(values);
  });
  const disconnect = () => { if (!busy) mutation.mutate(null); };

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
          noValidate
          onSubmit={connect}
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
                name: "site",
                type: "text",
                placeholder: "yourteam.atlassian.net",
              },
              {
                label: uiT("Atlassian email"),
                name: "email",
                type: "email",
                placeholder: "you@example.com",
              },
              {
                label: uiT("Jira API token"),
                name: "token",
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
                {...form.register(field.name)}
                aria-invalid={!!form.formState.errors[field.name]}
                placeholder={field.placeholder}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-content outline-none focus:border-content/20"
              />
              <FieldError errors={[form.formState.errors[field.name]]} />
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
              onClick={() => void projectQuery.refetch()}
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
