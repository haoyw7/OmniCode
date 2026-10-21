import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../../shared/lib/queryClient";
import { errorMessage } from "../../../../shared/lib/errorMessage";
import { githubIntegrationQuery, gitlabIntegrationQuery, azureDevOpsIntegrationQuery, linearIntegrationQuery } from "../../model/inboxIntegrationQueries";
import { inboxKeys, linearTeamsQuery } from "../../../inbox/model/inboxQueries";
import { usePreferenceState } from "../../model/usePreferenceState";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check } from "../../../../shared/ui/icons";
import { withToast } from "../../../../shared/ui/primitives/Sonner";
import { useEffect, useState } from "react";
import { Button } from "../../../../shared/ui/forms/Button";
import { clearInboxCache } from "../../../inbox/model/githubTasks";
import { disconnectGitlab, saveGitlabConfig } from "../../../inbox/model/gitlab";
import {
  disconnectAzureDevOps,
  saveAzureDevOpsConfig,
} from "../../../inbox/model/azureDevOps";
import {
  disconnectLinear,
  LINEAR_CHANGE_EVENT,
  loadHiddenLinearTeamIds,
  notifyLinearChange,
  saveHiddenLinearTeamIds,
  saveLinearToken,
} from "../../../inbox/model/linear";
import { Row } from "../settingsLayout";



export function GithubSettings() {
  const { t: uiT } = useTranslation();
  const query = useQuery(githubIntegrationQuery(), queryClient);
  const status = query.data;
  const checking = query.isFetching;
  const error = errorMessage(query.error);
  const checkStatus = () => query.refetch();

  const description = status?.connected
    ? "GitHub CLI is installed and authenticated. OmniCode uses it for GitHub inbox items."
    : status?.installed
      ? "Run gh auth login in a terminal, complete the sign-in flow, then check again."
      : "Install GitHub CLI from cli.github.com, run gh auth login in a terminal, then check again.";
  const label = checking
    ? "Checking"
    : status?.connected
      ? "Connected"
      : status?.installed
        ? "Sign in required"
        : "Not installed";

  return (
    <>
      <Row label={uiT("Connection")} description={description}>
        <span className="text-[12px] text-content/50">{label}</span>
        {!checking && !status?.installed ? (
          <Button variant="secondary"
            onClick={() => {
              void openUrl("https://cli.github.com/").catch(() => {});
            }}
          >
            {uiT("Installation guide")}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => void checkStatus()} disabled={checking}>
          {checking ? uiT("Checking") : uiT("Check again")}
        </Button>
      </Row>
      {error ? (
        <p className="border-b border-content/5 px-4 pb-3 text-[12px] text-red-400/90 last:border-b-0">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function GitlabSettings() {
  const { t: uiT } = useTranslation();
  const statusQuery = useQuery(gitlabIntegrationQuery(), queryClient);
  const [urlDraft, setUrl] = useState<string>();
  const url = urlDraft ?? (statusQuery.data?.url || "https://gitlab.com");
  const [token, setToken] = useState("");
  const connected = !!statusQuery.data?.connected;
  const mutation = useMutation({
    mutationFn: (action: "connect" | "disconnect") => withToast(
      () => action === "connect" ? saveGitlabConfig(url, token) : disconnectGitlab(url), {
        loading: uiT(action === "connect" ? "Connecting to {service}…" : "Disconnecting from {service}…", { service: "GitLab" }),
        success: result => action === "disconnect" ? uiT("Disconnected from {service}", { service: "GitLab" }) : result.connected && uiT("Connected to {service}", { service: "GitLab" }),
        error: false,
      }),
    onSuccess: async next => {
      await queryClient.cancelQueries({ queryKey: gitlabIntegrationQuery().queryKey });
      queryClient.setQueryData(gitlabIntegrationQuery().queryKey, next);
      setUrl(next.url || url); setToken(""); clearInboxCache();
      await Promise.all([invalidateAfterChange(inboxKeys.connections), invalidateAfterChange(inboxKeys.lists)]);
    },
  }, queryClient);
  const busy = mutation.isPending;
  const error = errorMessage(mutation.error ?? statusQuery.error);
  const onSave = () => { if (token.trim() && !busy) mutation.mutate("connect"); };
  const onDisconnect = () => { if (!busy) mutation.mutate("disconnect"); };

  return (
    <>
      <Row
        label={uiT("Connection")}
        description={uiT(
          "Connect GitLab.com or a self-managed GitLab instance. Use a personal access token with API access; the token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span className="max-w-56 truncate text-[12px] text-content/50">
              {url}
            </span>
            <Button variant="secondary"
              onClick={() => void onDisconnect()}
              disabled={busy}
            >
              {uiT("Disconnect")}
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label data-ui="input-group" className="flex h-7 w-52 max-w-full shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://gitlab.com"
                aria-label={uiT("GitLab URL")}
                autoComplete="url"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <label data-ui="input-group" className="flex h-7 w-52 max-w-full shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="glpat-…"
                aria-label={uiT("GitLab access token")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <Button variant="secondary"
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? uiT("Saving") : uiT("Connect")}
            </Button>
          </div>
        )}
      </Row>
      {error ? (
        <p className="border-b border-content/5 px-4 pb-3 text-[12px] text-red-400/90 last:border-b-0">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function AzureDevOpsSettings() {
  const { t: uiT } = useTranslation();
  const statusQuery = useQuery(azureDevOpsIntegrationQuery(), queryClient);
  const [urlDraft, setUrl] = useState<string>();
  const url = urlDraft ?? (statusQuery.data?.url || "https://dev.azure.com/myorg");
  const [token, setToken] = useState("");
  const connected = !!statusQuery.data?.connected;
  const mutation = useMutation({
    mutationFn: (action: "connect" | "disconnect") => withToast(
      () => action === "connect" ? saveAzureDevOpsConfig(url, token) : disconnectAzureDevOps(url), {
        loading: uiT(action === "connect" ? "Connecting to {service}…" : "Disconnecting from {service}…", { service: "Azure DevOps" }),
        success: result => action === "disconnect" ? uiT("Disconnected from {service}", { service: "Azure DevOps" }) : result.connected && uiT("Connected to {service}", { service: "Azure DevOps" }),
        error: false,
      }),
    onSuccess: async next => {
      await queryClient.cancelQueries({ queryKey: azureDevOpsIntegrationQuery().queryKey });
      queryClient.setQueryData(azureDevOpsIntegrationQuery().queryKey, next);
      setUrl(next.url || url); setToken(""); clearInboxCache();
      await Promise.all([invalidateAfterChange(inboxKeys.connections), invalidateAfterChange(inboxKeys.lists)]);
    },
  }, queryClient);
  const busy = mutation.isPending;
  const error = errorMessage(mutation.error ?? statusQuery.error);
  const onSave = () => { if (token.trim() && !busy) mutation.mutate("connect"); };
  const onDisconnect = () => { if (!busy) mutation.mutate("disconnect"); };

  return (
    <>
      <Row
        label={uiT("Connection")}
        description={uiT(
          "Connect your ADO organization with a personal access token (Boards + Repos read & write for comments). The token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span className="max-w-56 truncate text-[12px] text-content/50">
              {url}
            </span>
            <Button variant="secondary"
              onClick={() => void onDisconnect()}
              disabled={busy}
            >
              {uiT("Disconnect")}
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label data-ui="input-group" className="flex h-7 w-52 max-w-full shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://dev.azure.com/myorg"
                aria-label={uiT("Azure DevOps organization URL")}
                autoComplete="url"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <label data-ui="input-group" className="flex h-7 w-52 max-w-full shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="PAT…"
                aria-label={uiT("Azure DevOps personal access token")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <Button variant="secondary"
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? uiT("Saving") : uiT("Connect")}
            </Button>
          </div>
        )}
      </Row>
      {error ? (
        <p className="border-b border-content/5 px-4 pb-3 text-[12px] text-red-400/90 last:border-b-0">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function LinearSettings() {
  const { t: uiT } = useTranslation();
  const [token, setToken] = useState("");
  const statusQuery = useQuery(linearIntegrationQuery(), queryClient);
  const connected = !!statusQuery.data?.connected;
  const teamQuery = useQuery({ ...linearTeamsQuery(), enabled: connected }, queryClient);
  const teams = connected ? teamQuery.data ?? [] : [];
  const [hiddenTeamIds, setHiddenTeamIds] = usePreferenceState(loadHiddenLinearTeamIds);
  useEffect(() => {
    const onChange = () => setHiddenTeamIds(loadHiddenLinearTeamIds());
    window.addEventListener(LINEAR_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LINEAR_CHANGE_EVENT, onChange);
  }, []);
  const mutation = useMutation({
    mutationFn: (action: "connect" | "disconnect") => withToast(
      () => action === "connect" ? saveLinearToken(token) : disconnectLinear(), {
        loading: uiT(action === "connect" ? "Connecting to {service}…" : "Disconnecting from {service}…", { service: "Linear" }),
        success: uiT(action === "connect" ? "Connected to {service}" : "Disconnected from {service}", { service: "Linear" }),
        error: false,
      }),
    onSuccess: async (_result, action) => {
      await queryClient.cancelQueries({ queryKey: linearIntegrationQuery().queryKey });
      queryClient.setQueryData(linearIntegrationQuery().queryKey, { connected: action === "connect" });
      if (action === "disconnect") queryClient.setQueryData(linearTeamsQuery().queryKey, []);
      setToken(""); clearInboxCache(); notifyLinearChange();
      await Promise.all([invalidateAfterChange(inboxKeys.connections), invalidateAfterChange(inboxKeys.lists)]);
    },
  }, queryClient);
  const busy = mutation.isPending;
  const error = errorMessage(mutation.error ?? statusQuery.error ?? (connected ? teamQuery.error : null));
  const onSave = () => { if (token.trim() && !busy) mutation.mutate("connect"); };
  const onDisconnect = () => { if (!busy) mutation.mutate("disconnect"); };

  const toggleTeam = (id: string) => {
    const next = new Set(hiddenTeamIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    setHiddenTeamIds(ids);
    saveHiddenLinearTeamIds(ids);
    clearInboxCache();
  };

  return (
    <>
      <Row
        label={uiT("API key")}
        description={uiT(
          "Create a personal API key in Linear → Settings → Security & Access. Disconnect deletes it.",
        )}
      >
        {connected ? (
          <Button variant="secondary" onClick={() => void onDisconnect()} disabled={busy}>
            {uiT("Disconnect")}
          </Button>
        ) : (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <label data-ui="input-group" className="flex h-7 w-52 max-w-full shrink-0 items-center rounded-md border border-content/10 px-2 focus-within:border-content/20">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder="lin_api_…"
                aria-label={uiT("Linear API key")}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
              />
            </label>
            <Button variant="secondary"
              onClick={() => void onSave()}
              disabled={busy || !token.trim()}
            >
              {busy ? uiT("Saving") : uiT("Connect")}
            </Button>
          </div>
        )}
      </Row>
      {error ? (
        <p className="border-b border-content/5 px-4 pb-3 text-[12px] text-red-400/90 last:border-b-0">
          {error}
        </p>
      ) : null}
      {connected && teams.length > 0 ? (
        <div className="border-b border-content/5 px-4 py-3.5 last:border-b-0">
          <div className="text-[13px] font-medium text-content">
            {uiT("Teams")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {uiT("Unchecked teams stay out of the inbox.")}
          </p>
          <div className="-mx-2 mt-2 flex flex-col gap-0.5">
            {teams.map((team) => {
              const checked = !hiddenTeamIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] text-content hover:bg-content/3"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {team.name}
                    {team.key ? (
                      <span className="ml-1.5 text-content/40">{team.key}</span>
                    ) : null}
                  </span>
                  {checked ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
