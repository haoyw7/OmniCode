import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useCallback, useEffect, useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { queryClient } from "../../../shared/lib/queryClient";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";
import { Field, FieldError } from "../../../shared/ui/primitives/Field";
import { Empty, EmptyDescription } from "../../../shared/ui/primitives/Empty";
import { Skeleton } from "../../../shared/ui/primitives/Skeleton";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { ModalFooter } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronRight, Folder } from "../../../shared/ui/icons";
import {
  OPEN_CONNECTIONS_EVENT,
  remoteRequest,
  useRemoteMachines,
} from "../model/connections";
import { rememberRemoteProject } from "../model/remoteProjects";
import type {
  HostDirectory,
  HostProject,
  RemoteMachine,
} from "../model/protocol";

type Props = {
  onCancel: () => void;
  onOpen: (key: string) => void;
};

/** Adds a project whose folder is on a connected machine. Sessions in it run
 * on that machine; the project otherwise behaves like any other in the rail. */
export function AddRemoteProjectDialog({ onCancel, onOpen }: Props) {
  const { machines, loaded } = useRemoteMachines();
  const [machineId, setMachineId] = useState<string>();
  const machine =
    machines.find((entry) => entry.id === machineId) ?? machines[0];
  return (
    <RemoteProjectForm
      key={machine?.id ?? "unpaired"}
      machine={machine}
      machines={machines}
      loaded={loaded}
      onMachineChange={setMachineId}
      onCancel={onCancel}
      onOpen={onOpen}
    />
  );
}

function RemoteProjectForm({
  machine,
  machines,
  loaded,
  onMachineChange,
  onCancel,
  onOpen,
}: Props & {
  machine: RemoteMachine | undefined;
  machines: RemoteMachine[];
  loaded: boolean;
  onMachineChange: (id: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const instanceId = useId();
  const [browsePath, setBrowsePath] = useState<string>();
  const form = useForm({
    resolver: zodResolver(
      z.object({ path: z.string().trim().min(1, uiT("Enter a folder path")) }),
    ),
    defaultValues: { path: "" },
  });
  const path = useWatch({ control: form.control, name: "path" });
  const directoryQuery = useQuery(
    {
      queryKey: [
        "remote-project-directory",
        instanceId,
        machine?.id,
        browsePath,
      ],
      queryFn: () =>
        remoteRequest<HostDirectory>(machine!.id, "projects.browse", {
          path: browsePath,
        }),
      enabled: !!machine,
      gcTime: 0,
      refetchOnWindowFocus: false,
    },
    queryClient,
  );
  const directory = directoryQuery.data;
  const { setValue } = form;
  useEffect(() => {
    if (directory) setValue("path", directory.path, { shouldValidate: true });
  }, [directory, directoryQuery.dataUpdatedAt, setValue]);

  const openProject = useMutation(
    {
      mutationFn: (cwd: string) =>
        withToast(
          () =>
            remoteRequest<HostProject>(machine!.id, "projects.open", { cwd }),
          { loading: uiT("Opening…"), success: false, error: false },
        ),
    },
    queryClient,
  );
  const { reset: resetOpen } = openProject;
  const cancel = useCallback(() => {
    // Detach this observer so a response after cancellation cannot open a project.
    resetOpen();
    onCancel();
  }, [onCancel, resetOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  const browse = (next: string) => {
    resetOpen();
    if (next === browsePath) void directoryQuery.refetch();
    else setBrowsePath(next);
  };
  const error = openProject.error ?? directoryQuery.error;

  return createPortal(
    <div
      data-window-modal
      className="fixed inset-0"
      style={{ zIndex: LAYER.dialog }}
    >
      <div
        data-window-modal-backdrop
        className="absolute inset-0"
        onMouseDown={cancel}
      />
      <form
        data-window-modal-panel
        role="dialog"
        aria-modal="true"
        aria-label={uiT("Open folder on a machine")}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={form.handleSubmit(({ path: cwd }) => {
          if (!machine || openProject.isPending) return;
          openProject.mutate(cwd, {
            onSuccess: (project) =>
              onOpen(rememberRemoteProject(machine.environmentId, project).key),
          });
        })}
        className="popover-backdrop absolute left-1/2 top-[16%] flex max-h-[70vh] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="desktop-pane-heading text-[13px] font-medium leading-tight text-content">
            {uiT("Open folder on a machine")}
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            {uiT(
              "Sessions in this project run on that machine, using its checkout and its Codex or Claude Code sign-in. They keep running when you close OmniCode here.",
            )}
          </p>
        </div>
        {!loaded ? null : !machine ? (
          <>
            <p className="text-[12px] leading-snug text-content/55">
              {uiT(
                "No machines are connected yet. Add one in Settings, then open a folder on it here.",
              )}
            </p>
            <ModalFooter>
              <Button variant="secondary" onClick={cancel}>
                {uiT("Cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  cancel();
                  window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
                }}
              >
                {uiT("Add a machine")}
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            {machines.length > 1 ? (
              <SearchableSelect
                label={uiT("Machine")}
                value={machine.id}
                options={machines.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  keywords: entry.ssh?.target ?? entry.endpoint,
                }))}
                onChange={onMachineChange}
                searchable={false}
              />
            ) : (
              <p className="text-[12px] text-content/55">
                {uiT("On ")}
                <span className="text-content/80">{machine.name}</span>
              </p>
            )}
            <Controller
              control={form.control}
              name="path"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <Input
                    {...field}
                    aria-label={uiT("Folder path on the machine")}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={
                      fieldState.error ? `${instanceId}-path-error` : undefined
                    }
                    className="shrink-0 font-mono"
                    placeholder="/home/me/code/my-app"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                  <FieldError
                    id={`${instanceId}-path-error`}
                    errors={[fieldState.error]}
                  />
                </Field>
              )}
            />
            <div
              aria-label={uiT("Folders")}
              aria-busy={directoryQuery.isFetching}
              className="min-h-24 flex-1 overflow-y-auto overscroll-contain rounded-md border border-content/10"
            >
              <div className="p-1">
                {directory?.parent ? (
                  <FolderRow
                    name=".."
                    onOpen={() => void browse(directory.parent!)}
                  />
                ) : null}
                {directory?.entries.map((entry) => (
                  <FolderRow
                    key={entry.path}
                    name={entry.name}
                    onOpen={() => void browse(entry.path)}
                  />
                ))}
                {directory && !directory.entries.length ? (
                  <Empty className="p-2">
                    <EmptyDescription>{uiT("No subfolders")}</EmptyDescription>
                  </Empty>
                ) : null}
                {!directory && directoryQuery.isLoading ? (
                  <div
                    role="status"
                    aria-label={uiT("Loading folders…")}
                    className="space-y-2 p-2"
                  >
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-5 w-1/2" />
                  </div>
                ) : null}
              </div>
            </div>
            {error ? (
              <p
                role="alert"
                className="whitespace-pre-wrap break-words text-ui-sm leading-snug text-destructive"
              >
                {String(error).replace(/^Error: /, "")}
              </p>
            ) : null}
            <ModalFooter>
              <Button variant="secondary" onClick={cancel}>
                {uiT("Cancel")}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={openProject.isPending || !path.trim()}
              >
                {openProject.isPending ? uiT("Opening…") : uiT("Open")}
              </Button>
            </ModalFooter>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

function FolderRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      data-menu-row
      onClick={onOpen}
      className="w-full justify-start text-left"
    >
      <Folder className="size-3.5 shrink-0 text-content/45" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight className="size-3 shrink-0 text-content/30" />
    </Button>
  );
}
