import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { Textarea } from "../../../shared/ui/forms/Textarea";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../shared/ui/primitives/Tabs";
import { ChevronRight, Folder, Plus, X } from "../../../shared/ui/icons";
import { cn } from "../../../shared/lib/cn";
import { pickFolders } from "../../../platform/tauri/fs";
import { listWslDistributions, pickWslFolder } from "../../../platform/tauri/wsl";
import { OPEN_CONNECTIONS_EVENT, OPEN_REMOTE_PROJECT_EVENT, remoteRequest, useRemoteMachines } from "../model/connections";
import { ensureSharedProject, rememberRemoteProject } from "../model/remoteProjects";
import { environmentProjectPath, saveHostEnvironment } from "../model/hostEnvironments";
import type { HostEnvironmentDefinition, HostEnvironments } from "../model/hostState";
import type { HostDirectory, HostProject } from "../model/protocol";

const LOCAL = "local";
const ADD_SSH = "add-ssh";
const NO_HOSTS = "no-hosts";
const MAX_FOLDERS = 32;

/** Parses `KEY=value` lines; blank lines and `#` comments are ignored. */
export function parseEnvironmentVariables(text: string): {
  variables: Record<string, string>;
  error?: { line: number; reserved: boolean };
} {
  const variables: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) return { variables, error: { line: index + 1, reserved: false } };
    if (/^OMNICODE_/i.test(match[1])) return { variables, error: { line: index + 1, reserved: true } };
    let value = match[2].trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    variables[match[1]] = value;
  }
  return { variables };
}

/** Creates a named environment on this computer's Host or an SSH machine's
 * Host, then opens its first folder. */
export function NewEnvironmentDialog({ onClose, onOpen }: {
  onClose: () => void;
  /** Receives the opened project's rail key. */
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("local");

  const openFlow = (event: string) => {
    onClose();
    window.dispatchEvent(new Event(event));
  };

  return (
    <Modal title={t("New environment")} onClose={onClose} fitViewport>
      <Tabs value={tab} onValueChange={setTab} animated={false} className="flex-col gap-4 pt-3">
        <TabsList className="mx-4">
          {(["local", "ssh", "remote"] as const).map((value) => (
            <TabsTrigger key={value} value={value} className="px-3">
              {value === "ssh" ? "SSH" : t(value === "local" ? "Local" : "Remote Control")}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="local">
          <EnvironmentForm kind="local" onClose={onClose} onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="ssh">
          <EnvironmentForm kind="ssh" onClose={onClose} onOpen={onOpen}
            onAddConnection={() => openFlow(OPEN_CONNECTIONS_EVENT)} />
        </TabsContent>
        <TabsContent value="remote">
          <div className="flex flex-col gap-4 px-4 pb-4">
            <p className="text-ui-base text-foreground-subtle">
              {t("Open a folder on a connected machine. Sessions in it run on that machine and keep running when you close OmniCode here.")}
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => openFlow(OPEN_REMOTE_PROJECT_EVENT)}>{t("Open folder on a machine")}</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  );
}

function EnvironmentForm({ kind, onClose, onOpen, onAddConnection }: {
  kind: "local" | "ssh";
  onClose: () => void;
  onOpen: (key: string) => void;
  onAddConnection?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const [runIn, setRunIn] = useState(LOCAL);
  const [distributions, setDistributions] = useState<string[]>([]);
  const { machines } = useRemoteMachines(kind === "ssh");
  const hosts = machines.filter((machine) => machine.ssh);
  const [hostId, setHostId] = useState("");
  const host = hosts.find((machine) => machine.id === hostId);
  const [browsing, setBrowsing] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variablesText, setVariablesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (kind === "local")
      void listWslDistributions().then((names) => { if (alive.current) setDistributions(names); }, () => {});
    return () => { alive.current = false; };
  }, [kind]);

  const parsed = parseEnvironmentVariables(variablesText);
  const count = Object.keys(parsed.variables).length;
  const distribution = kind === "local" && runIn !== LOCAL ? runIn : undefined;
  const canCreate = !!name.trim() && folders.length > 0 && !parsed.error && !busy && (kind === "local" || !!host);
  const addPaths = (picked: string[]) =>
    setFolders((current) => [...current, ...picked.filter((path) => !current.includes(path))].slice(0, MAX_FOLDERS));
  // Folder paths belong to the machine they were picked on.
  const changeMachine = (apply: () => void) => {
    apply();
    setFolders([]);
    setBrowsing(false);
  };

  const addFolders = async () => {
    setError("");
    if (kind === "ssh") {
      setBrowsing(true);
      return;
    }
    try {
      const picked = distribution
        ? [await pickWslFolder(distribution, t("Add a folder"))].filter((path): path is string => !!path)
        : await pickFolders(t("Add folders"));
      if (alive.current && picked.length) addPaths(picked);
    } catch (reason) {
      if (alive.current) setError(t(String(reason).replace(/^Error: /, "")));
    }
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      const environment: HostEnvironmentDefinition = {
        id: crypto.randomUUID(), name: name.trim(), folders, variables: parsed.variables,
        ...(distribution ? { machine: { kind: "wsl" as const, distribution } } : {}),
      };
      if (host) {
        // The SSH machine's own Host applies the variables to its processes.
        await remoteRequest<HostEnvironments>(host.id, "environments.patch", {
          operationId: crypto.randomUUID(), changes: { [environment.id]: environment },
        });
        const project = await remoteRequest<HostProject>(host.id, "projects.open", { cwd: folders[0] });
        if (alive.current) onOpen(rememberRemoteProject(host.environmentId, project).key);
      } else {
        await saveHostEnvironment(environment);
        const project = await ensureSharedProject(environmentProjectPath(environment, folders[0]));
        if (alive.current) onOpen(project.key);
      }
    } catch (reason) {
      if (alive.current) setError(t(String(reason).replace(/^Error: /, "")));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => { event.preventDefault(); void create(); }}
    >
      <div className="flex flex-col gap-4 px-4">
        <label className="flex flex-col gap-1.5 text-ui-base font-medium text-foreground">
          {t("Name")}
          <Input className="font-normal" value={name} disabled={busy} autoFocus placeholder={t("My app")}
            autoComplete="off" spellCheck={false} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="flex flex-col gap-1.5 text-ui-base font-medium text-foreground">
          <span>{kind === "ssh" ? t("Host") : t("Run in")}</span>
          {kind === "ssh" ? (
            <SearchableSelect
              label={t("Host")}
              value={host?.id ?? ""}
              placeholder={t("Choose a host")}
              disabled={busy}
              searchable={false}
              options={[
                ...(hosts.length
                  ? hosts.map((machine) => ({ value: machine.id, label: machine.name, keywords: machine.ssh?.target }))
                  : [{ value: NO_HOSTS, label: t("No SSH hosts yet"), disabled: true }]),
                { value: ADD_SSH, label: t("Add SSH connection…"), icon: <Plus className="size-4" />, separatorBefore: true },
              ]}
              onChange={(next) => {
                if (next === ADD_SSH) onAddConnection?.();
                else if (next !== hostId) changeMachine(() => setHostId(next));
              }}
            />
          ) : (
            <SearchableSelect
              label={t("Run in")}
              value={runIn}
              disabled={busy}
              searchable={false}
              options={[
                { value: LOCAL, label: t("This computer") },
                ...distributions.map((entry) => ({ value: entry, label: `WSL · ${entry}`, group: "WSL" })),
              ]}
              onChange={(next) => { if (next !== runIn) changeMachine(() => setRunIn(next)); }}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-ui-base font-medium text-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>{t("Folders")}</span>
            <Button type="button" variant="secondary" size="sm"
              disabled={busy || folders.length >= MAX_FOLDERS || (kind === "ssh" && (!host || browsing))}
              onClick={() => void addFolders()}>
              <Plus data-icon="inline-start" />
              {t("Add")}
            </Button>
          </div>
          {host ? (
            <AnimatedCollapse expanded={browsing}>
              <RemoteFolderBrowser machineId={host.id} disabled={busy}
                onCancel={() => setBrowsing(false)}
                onPick={(path) => { addPaths([path]); setBrowsing(false); }} />
            </AnimatedCollapse>
          ) : null}
          <div className={cn("min-h-12 rounded-lg border border-dashed border-border p-1 font-normal",
            folders.length > 0 && "border-solid")} aria-label={t("Folders")}>
            {kind === "ssh" && !host ? (
              <p className="px-3 py-2.5 text-ui-base text-foreground-subtle">{t("Choose a host first.")}</p>
            ) : null}
            {folders.map((folder) => (
              <div key={folder} className="flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2">
                <Folder className="size-3.5 shrink-0 text-foreground-subtle" />
                <span className="min-w-0 flex-1 truncate font-mono text-ui-sm" title={folder}>{folder}</span>
                <Button type="button" variant="ghost" size="icon-sm" disabled={busy}
                  aria-label={t("Remove {value0}", { value0: folder })}
                  onClick={() => setFolders((current) => current.filter((entry) => entry !== folder))}>
                  <X />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={variablesOpen}
            aria-controls={`${id}-variables`}
            onClick={() => setVariablesOpen((open) => !open)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-surface-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-ui-base font-medium text-foreground">{t("Environment variables")}</span>
              <span className="block text-ui-sm text-foreground-subtle">
                {count ? t("{value0} for this environment", { value0: String(count) }) : t("None for this environment")}
              </span>
            </span>
            <DisclosureChevron expanded={variablesOpen} className="size-4 shrink-0 text-foreground-subtle" />
          </button>
          <AnimatedCollapse expanded={variablesOpen}>
            <div id={`${id}-variables`} className="flex flex-col gap-1.5 px-3 pb-3">
              <Textarea
                aria-label={t("Environment variables")}
                value={variablesText}
                disabled={busy}
                rows={5}
                spellCheck={false}
                placeholder={"API_URL=http://localhost:3000\nNODE_ENV=development"}
                className="font-mono text-ui-sm"
                onChange={(event) => setVariablesText(event.target.value)}
              />
              <p className={cn("text-ui-sm", parsed.error ? "text-red-400" : "text-foreground-subtle")}>
                {parsed.error
                  ? t(parsed.error.reserved ? "Line {value0}: OMNICODE_ variables are reserved" : "Line {value0}: use NAME=value",
                    { value0: String(parsed.error.line) })
                  : t("One NAME=value per line. Applied to agents started in these folders.")}
              </p>
            </div>
          </AnimatedCollapse>
        </div>
        {error ? <p role="alert" className="whitespace-pre-wrap break-words text-ui-sm text-red-400">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
        <Button type="submit" disabled={!canCreate}>
          {busy ? t("Creating…") : t("Create environment")}
        </Button>
      </div>
    </form>
  );
}

/** Browses folders through a connected machine's Host and returns one path. */
function RemoteFolderBrowser({ machineId, disabled, onCancel, onPick }: {
  machineId: string;
  disabled: boolean;
  onCancel: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [directory, setDirectory] = useState<HostDirectory>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);

  const browse = async (next?: string) => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const value = await remoteRequest<HostDirectory>(machineId, "projects.browse", { path: next });
      if (current !== version.current) return;
      setDirectory(value);
      setPath(value.path);
    } catch (reason) {
      if (current === version.current) setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (current === version.current) setLoading(false);
    }
  };

  useEffect(() => {
    setDirectory(undefined);
    setPath("");
    void browse();
    return () => { version.current++; };
  }, [machineId]);

  const rows = [
    ...(directory?.parent ? [{ name: "..", path: directory.parent }] : []),
    ...(directory?.entries ?? []),
  ];
  return (
    <div className="mb-1.5 flex flex-col gap-2 rounded-lg border border-border p-2 font-normal">
      <Input aria-label={t("Folder path on the machine")} className="font-mono" value={path} disabled={disabled}
        placeholder="/home/me/code/my-app" autoComplete="off" spellCheck={false}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void browse(path.trim() || undefined);
        }} />
      <div aria-label={t("Folders")} className="max-h-48 min-h-16 overflow-y-auto overscroll-contain">
        {rows.map((entry) => (
          <button key={entry.path} type="button" disabled={disabled} onClick={() => void browse(entry.path)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-base text-foreground transition-colors hover:bg-surface-hover">
            <Folder className="size-3.5 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
          </button>
        ))}
        {directory && !directory.entries.length ? (
          <p className="px-2 py-1 text-ui-sm text-foreground-subtle">{t("No subfolders")}</p>
        ) : null}
        {!directory && loading ? (
          <p className="px-2 py-1 text-ui-sm text-foreground-subtle">{t("Loading folders…")}</p>
        ) : null}
      </div>
      {error ? <p role="alert" className="whitespace-pre-wrap break-words text-ui-sm text-red-400">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>{t("Cancel")}</Button>
        <Button type="button" size="sm" disabled={disabled || !path.trim()} onClick={() => onPick(path.trim())}>
          {t("Add folder")}
        </Button>
      </div>
    </div>
  );
}
