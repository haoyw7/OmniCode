import type { Session } from "../../sessions/model/session";
import { createStore } from "zustand/vanilla";
import type {
  HostOrchestrationView,
  HostSession,
  HostSessionSummary,
} from "../../connections/model/protocol";
import {
  remotePath,
  type RemoteProject,
} from "../../connections/model/remoteProjects";
import { rememberRemoteSession, remoteSessionFor } from "../../connections/model/connections";

export type OrchestrationSource = {
  machineId: string;
  project: RemoteProject;
};
export type HostWorkerReference = OrchestrationSource & {
  leadId: string;
  sessionId: string;
};
export type OrchestrationReadRun = Pick<
  HostOrchestrationView,
  | "leadId"
  | "cwd"
  | "workspace"
  | "status"
  | "proposalId"
  | "allowedHarnesses"
  | "maxWorkers"
  | "error"
> & { tasks: HostOrchestrationView["tasks"] };

const keyFor = (source: OrchestrationSource, id: string) =>
  JSON.stringify([source.project.environmentId, source.project.projectId, id]);

/** Desktop cache of Host-owned state. It never schedules or starts a provider. */
export class OrchestrationClient {
  private records = new Map<
    string,
    {
      source: OrchestrationSource;
      revision: number;
      view: HostOrchestrationView;
    }
  >();
  private shells = new Map<string, string>();
  private runs: OrchestrationReadRun[] = [];
  readonly state = createStore(() => ({ runs: [] as OrchestrationReadRun[] }));
  subscribe = (listener: () => void) => {
    return this.state.subscribe(listener);
  };
  snapshot = () => this.state.getState().runs;

  bindShell(source: OrchestrationSource, hostId: string, shellId: string) {
    const key = keyFor(source, hostId);
    const owner = this.shells.get(key);
    if (owner === shellId) return;
    // Several tabs can show one host session. Each poll re-binds its own tab;
    // handing ownership back and forth republished every run to the whole
    // workspace, so a tab that still shows this session keeps it.
    if (owner && remoteSessionFor(owner) === hostId) {
      rememberRemoteSession(shellId, hostId, source.project);
      return;
    }
    this.shells.set(key, shellId);
    rememberRemoteSession(shellId, hostId, source.project);
    this.publish();
  }

  shellId(source: OrchestrationSource, hostId: string) {
    const key = keyFor(source, hostId);
    let id = this.shells.get(key);
    if (!id) {
      id = source.project.local ? hostId : crypto.randomUUID();
      this.shells.set(key, id);
      rememberRemoteSession(id, hostId, source.project);
    }
    return id;
  }

  accept(source: OrchestrationSource, value: HostSession | HostSessionSummary) {
    if (source.project.projectId !== value.projectId) return;
    const id = "session" in value ? value.session.id : value.id;
    const key = keyFor(source, id);
    const previous = this.records.get(key);
    if (previous && previous.revision > value.revision) return;
    if (!value.orchestration) {
      if (previous) {
        this.records.delete(key);
        this.publish();
      }
      return;
    }
    if (
      previous?.revision === value.revision &&
      JSON.stringify(previous.view) === JSON.stringify(value.orchestration)
    )
      return;
    this.records.set(key, {
      source,
      revision: value.revision,
      view: value.orchestration,
    });
    this.publish();
  }

  view(source: OrchestrationSource, leadId: string) {
    return this.records.get(keyFor(source, leadId))?.view;
  }

  forSession(shellId: string) {
    return this.runs.find(
      (run) =>
        run.leadId === shellId ||
        run.tasks.some((task) => task.sessionId === shellId),
    );
  }

  reference(shellId: string): HostWorkerReference | undefined {
    for (const { source, view } of this.records.values()) {
      if (this.shellId(source, view.leadId) === shellId)
        return { ...source, leadId: view.leadId, sessionId: view.leadId };
      const task = view.tasks.find(
        (entry) => this.shellId(source, entry.sessionId) === shellId,
      );
      if (task)
        return { ...source, leadId: view.leadId, sessionId: task.sessionId };
    }
  }

  forget(source: OrchestrationSource, leadId: string) {
    if (this.records.delete(keyFor(source, leadId))) this.publish();
  }

  retire(environmentId: string, ids: readonly string[]) {
    const retired = new Set(ids);
    let changed = false;
    for (const [key, { source, view }] of this.records) {
      if (
        source.project.environmentId === environmentId &&
        (retired.has(view.leadId) ||
          view.tasks.some((task) => retired.has(task.sessionId)))
      ) {
        this.records.delete(key);
        changed = true;
      }
    }
    for (const [key] of this.shells) {
      const [environment, , id] = JSON.parse(key);
      if (environment === environmentId && retired.has(id))
        this.shells.delete(key);
    }
    if (changed) this.publish();
  }

  desktopSession(source: OrchestrationSource, value: HostSession): Session {
    const toPath = (path: string) =>
      source.project.local
        ? path
        : remotePath(source.project.environmentId, path);
    return {
      ...value.session,
      id: this.shellId(source, value.session.id),
      cwd: source.project.key,
      executionCwd: toPath(value.session.executionCwd || value.session.cwd),
      orchestrationLeadId: value.session.orchestrationLeadId
        ? this.shellId(source, value.session.orchestrationLeadId)
        : undefined,
    };
  }

  private publish() {
    this.runs = [...this.records.values()].map(({ source, view }) => {
      const toPath = (path: string) =>
        source.project.local
          ? path
          : remotePath(source.project.environmentId, path);
      return {
        ...view,
        leadId: this.shellId(source, view.leadId),
        cwd: source.project.key,
        workspace: view.workspace && {
          ...view.workspace,
          id: JSON.stringify([source.project.environmentId, view.workspace.id]),
          projectCwd: source.project.key,
          checkoutCwd: toPath(view.workspace.checkoutCwd),
        },
        tasks: view.tasks.map((task) => ({
          ...task,
          sessionId: this.shellId(source, task.sessionId),
        })),
      };
    });
    this.state.setState({ runs: this.runs });
  }
}

export const hostOrchestrationClient = new OrchestrationClient();
