import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { beginDesktopSshConnection, reconnectDesktopSsh, pollDesktopSshConnection, cancelDesktopSshConnection, answerDesktopSshPrompt } from "../../../platform/tauri/connections";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { Internet, Loader } from "../../../shared/ui/icons";
import { ConnectionStatusIcon, type ConnectionState } from "./ConnectionStatusDot";
import { SshTargetInput } from "./SshTargetInput";
import { isSharedHostMachine } from "../model/remoteProjects";
import { publishHostConnection, removeHostConnection, useHostConnections } from "../model/hostConnections";
import { connectMachine, disconnectMachine, refreshRemoteMachines, remoteRequest, useRemoteMachines } from "../model/connections";
import { REMOTE_PROVIDERS } from "../../../contracts/provider";
import { type HostDescriptor, type RemoteMachine, type SshSetup } from "../../../contracts/protocol";

const input =
  "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-ui-base outline-none focus:border-content/35";
const pill =
  "h-7 shrink-0 rounded-full px-3 text-ui-base font-medium transition-colors disabled:opacity-40";
const button = `${pill} bg-selection text-foreground hover:bg-selection-hover`;
const primaryButton = `${pill} bg-foreground text-background hover:opacity-85`;
const quietButton = `${pill} text-foreground-subtle hover:bg-surface-hover hover:text-foreground`;

type MachineStatus = { state: ConnectionState; note: string };

export function ConnectionsSettings() {
  const { t: uiT } = useTranslation();
  const { machines, loaded } = useRemoteMachines();
  const directory = useHostConnections();
  const unpaired = directory.connections.filter((entry) => !machines.some((machine) => machine.environmentId === entry.environmentId));
  const [adding, setAdding] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const disclosureId = useId();
  const addTrigger = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [jobId, setJobId] = useState<string>();
  const [job, setJob] = useState<SshSetup>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [status, setStatus] = useState<Record<string, MachineStatus>>({});
  const [needsUpdate, setNeedsUpdate] = useState<Record<string, boolean>>({});
  const [updatingMachine, setUpdatingMachine] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [revoking, setRevoking] = useState(false);
  const [url, setUrl] = useState("http://127.0.0.1:3774");
  const [token, setToken] = useState("");
  const alive = useRef(true);
  const currentJob = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (currentJob.current)
        void cancelDesktopSshConnection(currentJob.current).catch(
          () => {},
        );
    };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await pollDesktopSshConnection(jobId);
        if (disposed) return;
        setJob(next);
        if (next.done) {
          currentJob.current = undefined;
          submitting.current = false;
          setBusy(false);
          setJobId(undefined);
          setAnswer("");
          if (next.error) setError(next.error);
          else if (next.machine) {
            setAdding(false);
            setTarget("");
            setName("");
            setPort("");
            setNotice(
              updatingMachine
                ? `${next.machine.name} was updated and reconnected.`
                : `${next.machine.name} is connected. To work on it, click + next to Projects in the project rail and choose Open folder on a machine.`,
            );
            setUpdatingMachine(undefined);
            setStatus((current) => ({
              ...current,
              [next.machine!.id]: { state: "online", note: "Connected" },
            }));
            refreshRemoteMachines();
            void publishHostConnection(next.machine).catch((reason) => setError(String(reason)));
          }
          return;
        }
      } catch (reason) {
        if (disposed) return;
        setError(String(reason));
        void cancelDesktopSshConnection(jobId).catch(() => {});
        currentJob.current = undefined;
        submitting.current = false;
        setBusy(false);
        setJobId(undefined);
        return;
      }
      timer = setTimeout(() => void poll(), 350);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [jobId, updatingMachine]);
  useEffect(() => {
    setAnswer("");
    setAnswering(false);
    if (job?.prompt)
      progress.current?.scrollIntoView?.({
        block: "nearest",
        behavior: reducedMotionQuery().matches ? "auto" : "smooth",
      });
  }, [job?.prompt?.id]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (!busy)
        await Promise.all(
          machines.map(async (machine) => {
            let label: MachineStatus = { state: "online", note: "Connected" };
            try {
              const host = await remoteRequest<HostDescriptor>(
                machine.id,
                "environment.describe",
                { supportedProviders: REMOTE_PROVIDERS },
              );
              if (host.environmentId !== machine.environmentId)
                throw new Error("Host identity changed");
              if (!host.providers.length)
                label = { state: "online", note: "Connected · install a supported provider on the host" };
              const update =
                !host.capabilities?.includes("workspace.run") ||
                !host.capabilities?.includes("git.worktreeCreate");
              if (update)
                label = { state: "online", note: "Connected · host update needed for Explorer and Changes" };
              if (!disposed)
                setNeedsUpdate((current) => ({
                  ...current,
                  [machine.id]: update,
                }));
            } catch {
              label = { state: "error", note: "Offline · reconnect to check access" };
            }
            if (!disposed)
              setStatus((current) => ({ ...current, [machine.id]: label }));
          }),
        );
      if (!disposed) timer = setTimeout(() => void check(), 10_000);
    };
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [machines, busy]);
  const begin = async (machine?: RemoteMachine, upgrade = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setJob(undefined);
    setUpdatingMachine(upgrade ? machine?.id : undefined);
    try {
      const id = machine
        ? await reconnectDesktopSsh(machine.id, upgrade)
        : await beginDesktopSshConnection(target.trim(), name.trim(), port ? Number(port) : null);
      if (!alive.current) {
        await cancelDesktopSshConnection(id);
        return;
      }
      currentJob.current = id;
      setJobId(id);
    } catch (reason) {
      submitting.current = false;
      if (alive.current) {
        setError(String(reason));
        setBusy(false);
      }
    }
  };
  const respond = async (value: string) => {
    if (!jobId || !job?.prompt || answering) return;
    setAnswering(true);
    setError("");
    try {
      await answerDesktopSshPrompt(jobId, job.prompt.id, value);
      setAnswer("");
    } catch (reason) {
      setError(String(reason));
      setAnswering(false);
    }
  };
  const remove = async (machine: RemoteMachine, revoke: boolean) => {
    if (isSharedHostMachine(machine)) return;
    setError("");
    setNotice("");
    setRevoking(true);
    try {
      if (revoke) {
        try {
          await remoteRequest(machine.id, "devices.revokeSelf");
        } catch (reason) {
          throw new Error(
            `Could not revoke access, so ${machine.name} was not removed: ${String(reason)}. Reconnect and try again, or remove it from this desktop only and revoke it on the host with omnicode-host devices and omnicode-host revoke <device-id>.`,
          );
        }
      }
      await disconnectMachine(machine.id);
      setRemoving(undefined);
      setNotice(
        revoke
          ? `${machine.name} was removed and this desktop's access was revoked. The host and its sessions keep running.`
          : `${machine.name} was removed from this desktop. The host and its sessions keep running, and it still accepts this desktop's credential.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setRevoking(false);
    }
  };
  return (
    <div data-setting-id="remote-machines" className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="desktop-pane-heading min-w-0 flex-1 text-ui-lg font-semibold text-foreground">
          {uiT("Your machines")}
        </h2>
        <button
          ref={addTrigger}
          type="button"
          className={primaryButton}
          disabled={busy}
          aria-expanded={adding}
          aria-controls={`${disclosureId}-add`}
          onClick={() => {
            setAdding((expanded) => !expanded);
            setError("");
            setNotice("");
          }}
        >
          {uiT("Add machine")}
        </button>
      </div>
      <p className="-mt-1 text-ui-caption leading-5 text-foreground-subtle">
        {uiT(
          "Run agents on another computer and return to them from your laptop. The host keeps working when you close OmniCode here.",
        )}
      </p>
      <div className="desktop-card divide-y divide-border overflow-hidden rounded-xl border border-border panel-card">
        {!loaded ? (
          <div className="flex items-center gap-2 px-4 py-4 text-ui-base text-foreground-subtle">
            <Loader className="size-4 animate-spin" />
            {uiT("Checking connection…")}
          </div>
        ) : machines.length === 0 ? (
          <p className="px-4 py-4 text-ui-base text-foreground-subtle">
            {uiT(
              "Add your always-on Windows, Mac, or Linux machine to get started.",
            )}
          </p>
        ) : (
          machines.map((machine) => {
            const local = isSharedHostMachine(machine);
            const current = status[machine.id];
            const state = current?.state ?? "checking";
            return (
            <div key={machine.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <ConnectionStatusIcon
                  state={state}
                  label={uiT(current?.note ?? "Checking connection…")}
                >
                  <Internet className="size-5" />
                </ConnectionStatusIcon>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui-base font-medium text-foreground">
                    {machine.name}
                  </div>
                  <div className="mt-0.5 truncate text-ui-caption text-foreground-subtle">
                    {machine.ssh
                      ? `SSH · ${machine.ssh.target}${machine.ssh.port ? ` · port ${machine.ssh.port}` : ""}`
                      : machine.endpoint}
                    {" · "}
                    <span className={state === "error" ? "text-red-400" : undefined}>
                      {uiT(current?.note ?? "Checking connection…")}
                    </span>
                  </div>
                  {machine.ssh && needsUpdate[machine.id] ? (
                    <div className="mt-0.5 text-ui-caption text-foreground-subtle">
                      {uiT(
                        "Updating restarts the host and interrupts active agent turns.",
                      )}
                    </div>
                  ) : null}
                </div>
                {machine.ssh && (
                  <div className="flex shrink-0 items-center gap-2">
                    {needsUpdate[machine.id] ? (
                      <button
                        className={button}
                        disabled={busy}
                        title={uiT(
                          "Downloads the matching host package and restarts the host; active agent turns will be interrupted",
                        )}
                        onClick={() => void begin(machine, true)}
                      >
                        {uiT("Update Host")}
                      </button>
                    ) : null}
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void begin(machine)}
                    >
                      {uiT("Reconnect")}
                    </button>
                  </div>
                )}
                <button
                  id={`${disclosureId}-remove-trigger-${machine.id}`}
                  disabled={local || busy || revoking}
                  className={quietButton}
                  aria-label={uiT("Remove {value0}", {
                    value0: String(machine.name),
                  })}
                  title={uiT(local ? "This computer cannot be removed." : "Remove connection…")}
                  aria-expanded={!local && removing === machine.id}
                  aria-controls={`${disclosureId}-remove-${machine.id}`}
                  onClick={() => {
                    if (local) return;
                    setError("");
                    setRemoving((current) =>
                      current === machine.id ? undefined : machine.id,
                    );
                  }}
                >
                  {uiT("Remove")}
                </button>
              </div>
              <AnimatedCollapse expanded={!local && removing === machine.id}>
                <div
                  id={`${disclosureId}-remove-${machine.id}`}
                  role="group"
                  aria-label={uiT("Confirm removing {value0}", {
                    value0: String(machine.name),
                  })}
                  className="flex flex-col gap-3 border-t border-border bg-content/3 px-4 py-4 text-ui-caption leading-5 text-foreground-subtle"
                >
                  <p className="text-ui-base font-medium text-foreground">
                    {uiT("Remove ")}
                    {machine.name} {uiT("from this desktop?")}
                  </p>
                  <p>
                    {uiT(
                      "This closes this desktop’s connection to the machine. It does not stop the host, and its sessions keep running and stay on that machine. You can add it again later.",
                    )}
                  </p>
                  <p>
                    {uiT(
                      "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
                    )}
                  </p>
                  <p>
                    {uiT(
                      "To stop the host and turn off its background service, run",
                    )}{" "}
                    <code className="rounded bg-content/10 px-1">
                      ~/.omnicode-host/bin/omnicode-host service uninstall
                    </code>{" "}
                    {uiT("on that machine (")}
                    <code className="rounded bg-content/10 px-1">
                      %USERPROFILE%\.omnicode-host\bin\omnicode-host.cmd service
                      uninstall
                    </code>{" "}
                    {uiT("on Windows). Its sessions and history are kept.")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={local || revoking}
                      onClick={() => void remove(machine, true)}
                    >
                      {uiT("Revoke access and remove")}
                    </button>
                    <button
                      className={button}
                      disabled={local || revoking}
                      onClick={() => void remove(machine, false)}
                    >
                      {uiT("Remove from this desktop only")}
                    </button>
                    <button
                      className={quietButton}
                      disabled={revoking}
                      onClick={() => {
                        setRemoving(undefined);
                        document
                          .getElementById(`${disclosureId}-remove-trigger-${machine.id}`)
                          ?.focus();
                      }}
                    >
                      {uiT("Cancel")}
                    </button>
                  </div>
                </div>
              </AnimatedCollapse>
            </div>
            );
          })
        )}
      </div>
      {directory.pending && <p role="status" className="text-ui-caption text-foreground-subtle">{uiT("Not yet synced")}</p>}
      {directory.error && <p role="status" className="text-ui-caption text-foreground-subtle">{directory.error}</p>}
      {unpaired.length > 0 && <div className="desktop-card divide-y divide-border overflow-hidden rounded-xl border border-border panel-card" aria-label={uiT("Shared connections")}>
        {unpaired.map((entry) => <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
          <Internet className="size-5 shrink-0 text-foreground-subtle" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-base font-medium text-foreground">{entry.name}</div>
            <div className="text-ui-caption text-foreground-subtle">{uiT("Not paired on this device")}</div>
          </div>
          <button type="button" className={button} disabled={busy} onClick={() => {
            setName(entry.name);
            setTarget(entry.kind === "ssh" ? entry.hostname ?? "" : "");
            setPort(entry.port ? String(entry.port) : "");
            setAdding(entry.kind === "ssh");
            setUrlOpen(entry.kind === "http");
            if (entry.kind === "http") setUrl(entry.hostname ? `http://${entry.hostname}:3774` : "");
          }}>{uiT("Pair this device")}</button>
          <button type="button" className={quietButton} disabled={busy} onClick={() => {
            void removeHostConnection(entry.id).catch((reason) => setError(String(reason)));
          }}>{uiT("Remove from shared directory")}</button>
        </div>)}
      </div>}
      </section>
      <AnimatedCollapse expanded={adding}>
        <form
          id={`${disclosureId}-add`}
          className="flex flex-col gap-3 rounded-xl border border-border panel-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void begin();
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="desktop-pane-heading text-ui-base font-semibold text-foreground">
              {uiT("Connect through SSH")}
            </h3>
            <span className="rounded-full bg-selection px-2 py-0.5 text-ui-caption text-foreground-subtle">
              SSH
            </span>
          </div>
          <label className="flex flex-col gap-1.5 text-ui-caption text-foreground-subtle">
            {uiT("SSH address")}
            <SshTargetInput
              disabled={busy}
              className={input}
              value={target}
              onChange={setTarget}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-caption text-foreground-subtle">
            {uiT("Name ")}
            <span className="sr-only">{uiT("(optional)")}</span>
            <input data-ui="input"
              disabled={busy}
              className={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={uiT("Optional, e.g. Home Mac mini")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <div className="text-ui-caption text-foreground-subtle">
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls={`${disclosureId}-advanced`}
              onClick={() => setAdvancedOpen((expanded) => !expanded)}
              className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            >
              {uiT("Advanced")}
            </button>
            <AnimatedCollapse expanded={advancedOpen}>
              <label
                id={`${disclosureId}-advanced`}
                className="mt-3 flex max-w-40 flex-col gap-1.5"
              >
                {uiT("SSH port")}
                <input data-ui="input"
                  disabled={busy}
                  type="number"
                  min={1}
                  max={65535}
                  className={input}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder={uiT("From SSH config")}
                />
              </label>
            </AnimatedCollapse>
          </div>
          <p className="text-ui-caption leading-5 text-foreground-subtle">
            {uiT(
              "OmniCode installs and starts its background host, then connects securely. Your SSH keys and config are used automatically. Enable SSH on the host and sign in to Codex or Claude Code there. On Windows and Mac, keep the host’s desktop account signed in and the machine awake. Locking the desktop is fine.",
            )}
          </p>
          <p className="text-ui-caption leading-5 text-foreground-subtle">
            {uiT(
              "On Linux, setup installs a systemd user service and turns on lingering for your account (",
            )}
            <code className="rounded bg-content/10 px-1">
              loginctl enable-linger
            </code>
            {uiT(
              "), so the host and your other user services keep running after you log out. The host keeps running until you stop it on that machine; removing it here only disconnects this desktop.",
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className={quietButton}
              onClick={() => {
                setAdding(false);
                addTrigger.current?.focus();
              }}
            >
              {uiT("Cancel")}
            </button>
            <button className={primaryButton} disabled={busy || !target.trim()}>
              {busy ? uiT("Connecting…") : uiT("Connect")}
            </button>
          </div>
        </form>
      </AnimatedCollapse>
      {busy && jobId && (
        <div
          className="desktop-card flex flex-col gap-3 rounded-xl border border-border panel-card p-4"
          role="status"
          ref={progress}
        >
          <div className="flex items-center gap-2 text-ui-base text-foreground">
            <Loader className="size-4 animate-spin" />
            {job?.message ?? uiT("Starting connection…")}
          </div>
          {job?.prompt && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void respond(job.prompt!.confirm ? "yes" : answer);
              }}
            >
              <p className="whitespace-pre-wrap break-words text-ui-caption leading-5 text-foreground-subtle">
                {job.prompt.message}
              </p>
              {!job.prompt.confirm && (
                <input data-ui="input"
                  key={job.prompt.id}
                  autoFocus
                  type="password"
                  aria-label={uiT("SSH password or passphrase")}
                  autoComplete="off"
                  disabled={answering}
                  className={input}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              )}
              <div className="flex gap-2">
                <button className={button} disabled={answering}>
                  {job.prompt.confirm
                    ? uiT("Trust host and continue")
                    : uiT("Continue")}
                </button>
                {job.prompt.confirm && (
                  <button
                    type="button"
                    className={button}
                    disabled={answering}
                    onClick={() => void respond("no")}
                  >
                    {uiT("Reject")}
                  </button>
                )}
              </div>
            </form>
          )}
          <button
            type="button"
            className={`${quietButton} self-start`}
            onClick={() => {
              if (jobId)
                void cancelDesktopSshConnection(jobId).catch((reason) =>
                  setError(String(reason)),
                );
            }}
          >
            {uiT("Cancel connection")}
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words text-ui-caption leading-5 text-red-400"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-ui-caption leading-5 text-emerald-500">
          {notice}
        </p>
      )}
      <div className="text-ui-caption text-foreground-subtle">
        <button type="button" className="cursor-pointer" aria-expanded={urlOpen}
          aria-controls={`${disclosureId}-url`} onClick={() => setUrlOpen((open) => !open)}>
          {uiT("Connect to an existing host by URL")}
        </button>
        <AnimatedCollapse expanded={urlOpen}>
        <form
          id={`${disclosureId}-url`}
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            void withStatusToast(() => connectMachine(name, url, token), {
              loading: uiT("Connecting to the machine…"),
              success: (machine) => uiT("Connected to {service}", { service: machine.name }),
              error: false,
            })
              .then(() => setToken(""))
              .catch((reason) => setError(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-col gap-1.5">
            {uiT("Host URL")}
            <input data-ui="input"
              required
              disabled={busy}
              className={input}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            {uiT("Device token")}
            <input data-ui="input"
              required
              disabled={busy}
              type="password"
              autoComplete="off"
              className={input}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button className={`${button} self-start`} disabled={busy}>
            {uiT("Connect by URL")}
          </button>
        </form>
        </AnimatedCollapse>
      </div>
    </div>
  );
}
