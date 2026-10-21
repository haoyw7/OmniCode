import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient } from "../../../shared/lib/queryClient";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import {
  Field,
  FieldError,
  FieldLabel,
} from "../../../shared/ui/primitives/Field";
import { Skeleton } from "../../../shared/ui/primitives/Skeleton";
import { Empty, EmptyDescription } from "../../../shared/ui/primitives/Empty";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { reducedMotionQuery } from "../../../shared/lib/reducedMotion";
import { Internet } from "../../../shared/ui/icons";
import {
  ConnectionStatusIcon,
  type ConnectionState,
} from "./ConnectionStatusDot";
import { SshTargetInput } from "./SshTargetInput";
import { isSharedHostMachine } from "../model/remoteProjects";
import {
  publishHostConnection,
  removeHostConnection,
  useHostConnections,
} from "../model/hostConnections";
import {
  connectMachine,
  disconnectMachine,
  refreshRemoteMachines,
  remoteRequest,
  useRemoteMachines,
} from "../model/connections";
import {
  REMOTE_PROVIDERS,
  type HostDescriptor,
  type RemoteMachine,
  type SshSetup,
} from "../model/protocol";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type MachineStatus = { state: ConnectionState; note: string };

export function ConnectionsSettings() {
  const { t: uiT } = useTranslation();
  const { machines, loaded } = useRemoteMachines();
  const directory = useHostConnections();
  const unpaired = directory.connections.filter(
    (entry) =>
      !machines.some(
        (machine) => machine.environmentId === entry.environmentId,
      ),
  );
  const [adding, setAdding] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const disclosureId = useId();
  const addTrigger = useRef<HTMLButtonElement>(null);
  const sshForm = useForm({
    resolver: zodResolver(
      z.object({
        target: z.string().trim().min(1, uiT("Enter an SSH address")),
        name: z.string().trim(),
        port: z
          .string()
          .trim()
          .refine(
            (value) =>
              !value ||
              (/^\d+$/.test(value) &&
                Number(value) >= 1 &&
                Number(value) <= 65535),
            uiT("Enter a port between 1 and 65535"),
          ),
      }),
    ),
    defaultValues: { target: "", name: "", port: "" },
  });
  const urlForm = useForm({
    resolver: zodResolver(
      z.object({
        url: z
          .string()
          .trim()
          .url(uiT("Enter a valid HTTP or HTTPS URL"))
          .refine(
            (value) => /^https?:\/\//i.test(value),
            uiT("Enter a valid HTTP or HTTPS URL"),
          ),
        token: z.string().trim().min(1, uiT("Enter a device token")),
      }),
    ),
    defaultValues: { url: "http://127.0.0.1:3774", token: "" },
  });
  const answerForm = useForm({
    resolver: zodResolver(z.object({ answer: z.string() })),
    defaultValues: { answer: "" },
  });
  const target = useWatch({ control: sshForm.control, name: "target" });
  const [jobSession, setJobSession] = useState<{
    id: string;
    attempt: string;
    upgrade: boolean;
  }>();
  const jobId = jobSession?.id;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string>();
  const alive = useRef(true);
  const currentJob = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (currentJob.current)
        void invoke("remote_ssh_cancel", { jobId: currentJob.current }).catch(
          () => {},
        );
    };
  }, []);
  const reportError = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : String(reason));
  const publishMutation = useMutation(
    {
      mutationFn: publishHostConnection,
      onError: reportError,
    },
    queryClient,
  );
  const { mutate: publishConnection } = publishMutation;
  const cancelMutation = useMutation(
    {
      mutationFn: (id: string) =>
        withToast(() => invoke("remote_ssh_cancel", { jobId: id }), {
          loading: uiT("Cancelling…"),
          success: false,
          error: false,
        }),
      onError: reportError,
    },
    queryClient,
  );
  const { mutate: cancelSetup } = cancelMutation;
  const beginMutation = useMutation(
    {
      mutationFn: ({
        machine,
        upgrade,
      }: {
        machine?: RemoteMachine;
        upgrade: boolean;
      }) =>
        withToast(
          async () => {
            const { target, name, port } = sshForm.getValues();
            const id = machine
              ? await invoke<string>("remote_ssh_reconnect", {
                  machineId: machine.id,
                  ...(upgrade ? { upgrade: true } : {}),
                })
              : await invoke<string>("remote_ssh_begin", {
                  target: target.trim(),
                  name: name.trim(),
                  port: port ? Number(port) : null,
                });
            // The native job can be allocated after Settings has already unmounted.
            if (!alive.current) {
              await invoke("remote_ssh_cancel", { jobId: id });
              return;
            }
            currentJob.current = id;
            setJobSession({ id, attempt: crypto.randomUUID(), upgrade });
          },
          { loading: uiT("Connecting…"), success: false },
        ),
      onError: (reason) => {
        submitting.current = false;
        if (alive.current) reportError(reason);
      },
    },
    queryClient,
  );
  const connectMutation = useMutation(
    {
      mutationFn: ({ url, token }: { url: string; token: string }) =>
        withToast(
          () => connectMachine(sshForm.getValues("name").trim(), url, token),
          {
            loading: uiT("Connecting to the machine…"),
            success: (machine) =>
              uiT("Connected to {service}", { service: machine.name }),
          },
        ),
      onError: reportError,
    },
    queryClient,
  );
  const jobQuery = useQuery(
    {
      queryKey: ["ssh-setup", disclosureId, jobId, jobSession?.attempt],
      queryFn: () => invoke<SshSetup>("remote_ssh_poll", { jobId }),
      enabled: !!jobId,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: (query) =>
        query.state.data?.done || query.state.status === "error" ? false : 350,
      refetchIntervalInBackground: true,
    },
    queryClient,
  );
  const job = jobQuery.data;
  const busy =
    beginMutation.isPending ||
    connectMutation.isPending ||
    (!!jobId && !job?.done && !jobQuery.isError);
  const statusQueries = useQueries(
    {
      queries: machines.map((machine) => ({
        queryKey: [
          "machine-status",
          machine.id,
          machine.environmentId,
          machine.endpoint,
        ],
        queryFn: async () => {
          const host = await remoteRequest<HostDescriptor>(
            machine.id,
            "environment.describe",
            { supportedProviders: REMOTE_PROVIDERS },
          );
          if (host.environmentId !== machine.environmentId)
            throw new Error("Host identity changed");
          const update =
            !host.capabilities?.includes("workspace.run") ||
            !host.capabilities?.includes("git.worktreeCreate");
          return {
            update,
            note: update
              ? "Connected · host update needed for Explorer and Changes"
              : host.providers.length
                ? "Connected"
                : "Connected · install a supported provider on the host",
          };
        },
        enabled: !busy,
        refetchInterval: 10_000,
      })),
    },
    queryClient,
  );
  const status = Object.fromEntries(
    machines.map((machine, index) => {
      const query = statusQueries[index];
      const value: MachineStatus = query.isError
        ? { state: "error", note: "Offline · reconnect to check access" }
        : query.data
          ? { state: "online", note: query.data.note }
          : { state: "checking", note: "Checking connection…" };
      return [machine.id, value];
    }),
  );
  const needsUpdate = Object.fromEntries(
    machines.map((machine, index) => [
      machine.id,
      statusQueries[index].data?.update,
    ]),
  );
  const { reset: resetSsh } = sshForm;
  const { reset: resetAnswer } = answerForm;
  useEffect(() => {
    if (!jobId || currentJob.current !== jobId) return;
    if (jobQuery.error) {
      setError(String(jobQuery.error));
      cancelSetup(jobId);
      currentJob.current = undefined;
      submitting.current = false;
    } else if (job?.done) {
      currentJob.current = undefined;
      submitting.current = false;
      resetAnswer();
      if (job.error) setError(job.error);
      else if (job.machine) {
        setAdding(false);
        resetSsh();
        setNotice(
          jobSession?.upgrade
            ? uiT("{name} was updated and reconnected.", {
                name: job.machine.name,
              })
            : uiT(
                "{name} is connected. To work on it, click + next to Projects in the project rail and choose Open folder on a machine.",
                { name: job.machine.name },
              ),
        );
        refreshRemoteMachines();
        publishConnection(job.machine);
      }
    }
  }, [
    jobId,
    job,
    jobQuery.error,
    jobSession?.upgrade,
    cancelSetup,
    publishConnection,
    resetSsh,
    resetAnswer,
    uiT,
  ]);
  const answerMutation = useMutation(
    {
      mutationFn: (request: {
        jobId: string;
        promptId: string;
        answer: string;
      }) =>
        withToast(() => invoke("remote_ssh_answer", request), {
          loading: uiT("Sending answer…"),
          success: false,
        }),
      onError: reportError,
    },
    queryClient,
  );
  const { reset: resetAnswerMutation } = answerMutation;
  // Keep a prompt disabled after a successful answer until native SSH moves on.
  const answering =
    (answerMutation.isPending || answerMutation.isSuccess) &&
    answerMutation.variables?.promptId === job?.prompt?.id;
  useEffect(() => {
    resetAnswer();
    resetAnswerMutation();
    if (job?.prompt)
      progress.current?.scrollIntoView?.({
        block: "nearest",
        behavior: reducedMotionQuery().matches ? "auto" : "smooth",
      });
  }, [job?.prompt?.id, resetAnswer, resetAnswerMutation]);
  const begin = (machine?: RemoteMachine, upgrade = false) => {
    if (submitting.current || busy) return;
    submitting.current = true;
    setError("");
    setNotice("");
    setJobSession(undefined);
    beginMutation.mutate({ machine, upgrade });
  };
  const respond = (value: string) => {
    if (!jobId || !job?.prompt || answering) return;
    setError("");
    const promptId = job.prompt.id;
    answerMutation.mutate(
      { jobId, promptId, answer: value },
      {
        onSuccess: () => {
          // Never clear an answer being typed for a newer prompt.
          if (
            queryClient.getQueryData<SshSetup>([
              "ssh-setup",
              disclosureId,
              jobId,
              jobSession?.attempt,
            ])?.prompt?.id === promptId
          )
            resetAnswer();
        },
      },
    );
  };
  const removeMutation = useMutation(
    {
      mutationFn: ({
        machine,
        revoke,
      }: {
        machine: RemoteMachine;
        revoke: boolean;
      }) =>
        withToast(
          async () => {
            if (revoke) {
              try {
                await remoteRequest(machine.id, "devices.revokeSelf");
              } catch (reason) {
                throw new Error(
                  uiT(
                    "Could not revoke access, so {name} was not removed: {reason}. Reconnect and try again, or remove it from this desktop only and revoke it on the host with omnicode-host devices and omnicode-host revoke <device-id>.",
                    { name: machine.name, reason: String(reason) },
                  ),
                );
              }
            }
            await disconnectMachine(machine.id);
          },
          { loading: uiT("Removing…"), success: false, error: false },
        ),
      onError: reportError,
    },
    queryClient,
  );
  const revoking = removeMutation.isPending;
  const remove = (machine: RemoteMachine, revoke: boolean) => {
    if (isSharedHostMachine(machine) || revoking) return;
    setError("");
    setNotice("");
    removeMutation.mutate(
      { machine, revoke },
      {
        onSuccess: () => {
          setRemoving(undefined);
          setNotice(
            revoke
              ? uiT(
                  "{name} was removed and this desktop's access was revoked. The host and its sessions keep running.",
                  { name: machine.name },
                )
              : uiT(
                  "{name} was removed from this desktop. The host and its sessions keep running, and it still accepts this desktop's credential.",
                  { name: machine.name },
                ),
          );
        },
      },
    );
  };
  const removeSharedMutation = useMutation(
    {
      mutationFn: (id: string) =>
        withToast(() => removeHostConnection(id), {
          loading: uiT("Removing…"),
          success: false,
          error: false,
        }),
      onError: reportError,
    },
    queryClient,
  );

  return (
    <div data-setting-id="remote-machines" className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="desktop-pane-heading min-w-0 flex-1 text-ui-lg font-semibold text-foreground">
            {uiT("Your machines")}
          </h2>
          <Button
            ref={addTrigger}
            type="button"
            variant="primary"
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
          </Button>
        </div>
        <p className="-mt-1 text-ui-caption leading-5 text-foreground-subtle">
          {uiT(
            "Run agents on another computer and return to them from your laptop. The host keeps working when you close OmniCode here.",
          )}
        </p>
        <div className="desktop-card divide-y divide-border overflow-hidden rounded-xl border border-border panel-card">
          {!loaded ? (
            <div
              role="status"
              aria-label={uiT("Checking connection…")}
              className="space-y-2 p-4"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : machines.length === 0 ? (
            <Empty className="p-4">
              <EmptyDescription>
                {uiT(
                  "Add your always-on Windows, Mac, or Linux machine to get started.",
                )}
              </EmptyDescription>
            </Empty>
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
                        <span
                          className={
                            state === "error" ? "text-red-400" : undefined
                          }
                        >
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
                          <Button
                            variant="secondary"
                            disabled={busy}
                            title={uiT(
                              "Downloads the matching host package and restarts the host; active agent turns will be interrupted",
                            )}
                            onClick={() => void begin(machine, true)}
                          >
                            {uiT("Update Host")}
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void begin(machine)}
                        >
                          {uiT("Reconnect")}
                        </Button>
                      </div>
                    )}
                    <Button
                      id={`${disclosureId}-remove-trigger-${machine.id}`}
                      disabled={local || busy || revoking}
                      variant="ghost"
                      aria-label={uiT("Remove {value0}", {
                        value0: String(machine.name),
                      })}
                      title={uiT(
                        local
                          ? "This computer cannot be removed."
                          : "Remove connection…",
                      )}
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
                    </Button>
                  </div>
                  <AnimatedCollapse
                    expanded={!local && removing === machine.id}
                  >
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
                          %USERPROFILE%\.omnicode-host\bin\omnicode-host.cmd
                          service uninstall
                        </code>{" "}
                        {uiT("on Windows). Its sessions and history are kept.")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={local || revoking}
                          onClick={() => void remove(machine, true)}
                        >
                          {uiT("Revoke access and remove")}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={local || revoking}
                          onClick={() => void remove(machine, false)}
                        >
                          {uiT("Remove from this desktop only")}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={revoking}
                          onClick={() => {
                            setRemoving(undefined);
                            document
                              .getElementById(
                                `${disclosureId}-remove-trigger-${machine.id}`,
                              )
                              ?.focus();
                          }}
                        >
                          {uiT("Cancel")}
                        </Button>
                      </div>
                    </div>
                  </AnimatedCollapse>
                </div>
              );
            })
          )}
        </div>
        {directory.pending && (
          <p role="status" className="text-ui-caption text-foreground-subtle">
            {uiT("Not yet synced")}
          </p>
        )}
        {directory.error && (
          <p role="status" className="text-ui-caption text-foreground-subtle">
            {directory.error}
          </p>
        )}
        {unpaired.length > 0 && (
          <div
            className="desktop-card divide-y divide-border overflow-hidden rounded-xl border border-border panel-card"
            aria-label={uiT("Shared connections")}
          >
            {unpaired.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <Internet className="size-5 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui-base font-medium text-foreground">
                    {entry.name}
                  </div>
                  <div className="text-ui-caption text-foreground-subtle">
                    {uiT("Not paired on this device")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    sshForm.reset({
                      name: entry.name,
                      target:
                        entry.kind === "ssh" ? (entry.hostname ?? "") : "",
                      port: entry.port ? String(entry.port) : "",
                    });
                    setAdding(entry.kind === "ssh");
                    setUrlOpen(entry.kind === "http");
                    if (entry.kind === "http")
                      urlForm.setValue(
                        "url",
                        entry.hostname ? `http://${entry.hostname}:3774` : "",
                      );
                  }}
                >
                  {uiT("Pair this device")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || removeSharedMutation.isPending}
                  onClick={() => {
                    setError("");
                    removeSharedMutation.mutate(entry.id);
                  }}
                >
                  {uiT("Remove from shared directory")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <AnimatedCollapse expanded={adding}>
        <form
          id={`${disclosureId}-add`}
          className="flex flex-col gap-3 rounded-xl border border-border panel-card p-4"
          onSubmit={sshForm.handleSubmit(() => begin())}
        >
          <div className="flex items-center justify-between">
            <h3 className="desktop-pane-heading text-ui-base font-semibold text-foreground">
              {uiT("Connect through SSH")}
            </h3>
            <span className="rounded-full bg-selection px-2 py-0.5 text-ui-caption text-foreground-subtle">
              SSH
            </span>
          </div>
          <Controller
            control={sshForm.control}
            name="target"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${disclosureId}-target`}>
                  {uiT("SSH address")}
                </FieldLabel>
                <SshTargetInput
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  id={`${disclosureId}-target`}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={
                    fieldState.error
                      ? `${disclosureId}-target-error`
                      : undefined
                  }
                  disabled={busy}
                />
                <FieldError
                  id={`${disclosureId}-target-error`}
                  errors={[fieldState.error]}
                />
              </Field>
            )}
          />
          <Controller
            control={sshForm.control}
            name="name"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${disclosureId}-name`}>
                  {uiT("Name ")}
                  <span className="sr-only">{uiT("(optional)")}</span>
                </FieldLabel>
                <Input
                  {...field}
                  id={`${disclosureId}-name`}
                  disabled={busy}
                  placeholder={uiT("Optional, e.g. Home Mac mini")}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </Field>
            )}
          />
          <div className="text-ui-caption text-foreground-subtle">
            <Button
              type="button"
              variant="ghost"
              aria-expanded={advancedOpen}
              aria-controls={`${disclosureId}-advanced`}
              onClick={() => setAdvancedOpen((expanded) => !expanded)}
              className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            >
              {uiT("Advanced")}
            </Button>
            <AnimatedCollapse expanded={advancedOpen}>
              <Controller
                control={sshForm.control}
                name="port"
                render={({ field, fieldState }) => (
                  <Field
                    id={`${disclosureId}-advanced`}
                    data-invalid={fieldState.invalid}
                    className="mt-3 max-w-40"
                  >
                    <FieldLabel htmlFor={`${disclosureId}-port`}>
                      {uiT("SSH port")}
                    </FieldLabel>
                    <Input
                      {...field}
                      id={`${disclosureId}-port`}
                      disabled={busy}
                      type="number"
                      min={1}
                      max={65535}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={
                        fieldState.error
                          ? `${disclosureId}-port-error`
                          : undefined
                      }
                      placeholder={uiT("From SSH config")}
                    />
                    <FieldError
                      id={`${disclosureId}-port-error`}
                      errors={[fieldState.error]}
                    />
                  </Field>
                )}
              />
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
            <Button
              type="button"
              disabled={busy}
              variant="ghost"
              onClick={() => {
                setAdding(false);
                addTrigger.current?.focus();
              }}
            >
              {uiT("Cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !target.trim()}
            >
              {busy ? uiT("Connecting…") : uiT("Connect")}
            </Button>
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
            <Spinner className="size-4" />
            {job?.message ?? uiT("Starting connection…")}
          </div>
          {job?.prompt && (
            <form
              className="flex flex-col gap-3"
              onSubmit={answerForm.handleSubmit(({ answer }) =>
                respond(job.prompt!.confirm ? "yes" : answer),
              )}
            >
              <p className="whitespace-pre-wrap break-words text-ui-caption leading-5 text-foreground-subtle">
                {job.prompt.message}
              </p>
              {!job.prompt.confirm && (
                <Controller
                  control={answerForm.control}
                  name="answer"
                  render={({ field }) => (
                    <Input
                      {...field}
                      key={job.prompt!.id}
                      autoFocus
                      type="password"
                      aria-label={uiT("SSH password or passphrase")}
                      autoComplete="off"
                      disabled={answering}
                    />
                  )}
                />
              )}
              <div className="flex gap-2">
                <Button variant="secondary" type="submit" disabled={answering}>
                  {job.prompt.confirm
                    ? uiT("Trust host and continue")
                    : uiT("Continue")}
                </Button>
                {job.prompt.confirm && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={answering}
                    onClick={() => void respond("no")}
                  >
                    {uiT("Reject")}
                  </Button>
                )}
              </div>
            </form>
          )}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            disabled={cancelMutation.isPending}
            onClick={() => {
              if (jobId) cancelSetup(jobId);
            }}
          >
            {uiT("Cancel connection")}
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words text-ui-caption leading-5 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-ui-caption leading-5 text-success">
          {notice}
        </p>
      )}
      <div className="text-ui-caption text-foreground-subtle">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={urlOpen}
          aria-controls={`${disclosureId}-url`}
          onClick={() => setUrlOpen((open) => !open)}
        >
          {uiT("Connect to an existing host by URL")}
        </Button>
        <AnimatedCollapse expanded={urlOpen}>
          <form
            id={`${disclosureId}-url`}
            className="mt-4 flex flex-col gap-3"
            onSubmit={urlForm.handleSubmit((values) => {
              if (busy) return;
              setError("");
              connectMutation.mutate(values, {
                onSuccess: () => urlForm.setValue("token", ""),
              });
            })}
          >
            <Controller
              control={urlForm.control}
              name="url"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${disclosureId}-host-url`}>
                    {uiT("Host URL")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id={`${disclosureId}-host-url`}
                    required
                    disabled={busy}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={
                      fieldState.error ? `${disclosureId}-url-error` : undefined
                    }
                  />
                  <FieldError
                    id={`${disclosureId}-url-error`}
                    errors={[fieldState.error]}
                  />
                </Field>
              )}
            />
            <Controller
              control={urlForm.control}
              name="token"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${disclosureId}-token`}>
                    {uiT("Device token")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id={`${disclosureId}-token`}
                    required
                    disabled={busy}
                    type="password"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    aria-describedby={
                      fieldState.error
                        ? `${disclosureId}-token-error`
                        : undefined
                    }
                  />
                  <FieldError
                    id={`${disclosureId}-token-error`}
                    errors={[fieldState.error]}
                  />
                </Field>
              )}
            />
            <Button
              variant="secondary"
              type="submit"
              className="self-start"
              disabled={busy}
            >
              {uiT("Connect by URL")}
            </Button>
          </form>
        </AnimatedCollapse>
      </div>
    </div>
  );
}
