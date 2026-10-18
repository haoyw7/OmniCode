import { dirname, join } from "node:path";
import { configureChildBackend, configureChildMachineSelector, removeChildBackend } from "../src/integrations/harness/core/child";
import { parseProjectMachine, projectMachineKey, type ProjectMachine } from "../src/integrations/harness/core/machine";
import type { HostStore } from "./store";
import type { HostProvider } from "./providers";
import type { RemoteProvider } from "../src/integrations/harness/core/provider";
import { currentMachineIO, localMachineIO, withMachineIO, WslMachineIO, type MachineIO, type MachineTransport } from "./machine-io";
import { WslConnection } from "./machines/wsl";
import { WslChildBackend } from "./wsl-child-backend";
import type { HostChildBackend } from "./child-backend";
import { importLegacyWslHost } from "./wsl-import";
import { wslControlLauncher, wslSessionEnvironment } from "./wsl-control";
import type { HarnessBotContext } from "../src/integrations/harness/core/botContext";

export class HostMachines {
  private wsl = new Map<string, { io: WslMachineIO; connection: WslConnection; transport: MachineTransport; backend: WslChildBackend }>();
  private prepared = new Map<string, Promise<unknown>>();
  private transformImported?: (value: ReturnType<HostStore["session"]>) => ReturnType<HostStore["session"]>;
  private notice: (id: string, warnings: string[]) => void = () => {};
  constructor(private readonly store: HostStore, private readonly local: HostChildBackend,
    private readonly connectionFactory?: (distribution: string) => WslConnection) {
    configureChildBackend(local);
    configureChildMachineSelector(() => currentMachineIO().key);
  }

  io(machine?: ProjectMachine): MachineIO {
    if (!machine) return localMachineIO;
    if (process.platform !== "win32" && !this.connectionFactory) throw new Error("WSL environments require Windows");
    const key = projectMachineKey(machine);
    const existing = this.wsl.get(key); if (existing) return existing.io;
    const connection = this.connectionFactory?.(machine.distribution) ?? new WslConnection({ distribution: machine.distribution });
    // Constructing a scope for stored history does not connect the distribution.
    const transport = connection;
    const io = new WslMachineIO(machine.distribution, transport);
    const owner = join(dirname(this.store.databasePath), "desktop-owner.json");
    const backend = new WslChildBackend(transport, io, this.local, owner, (id, warnings) => this.notice(id, warnings),
      undefined, id => wslSessionEnvironment(io, this.local.environmentForSession(id)), this.store);
    configureChildBackend(backend, key);
    this.wsl.set(key, { io, connection, transport, backend });
    return io;
  }

  run<T>(machine: ProjectMachine | undefined, operation: () => T): T {
    return withMachineIO(this.io(machine), operation);
  }
  configureImport(transform: (value: ReturnType<HostStore["session"]>) => ReturnType<HostStore["session"]>): void { this.transformImported = transform; }
  configureNotice(notice: (id: string, warnings: string[]) => void): void { this.notice = notice; }
  workspaceReady(machine?: ProjectMachine): boolean {
    return !machine || this.prepared.has(projectMachineKey(machine));
  }
  async prepare(machine?: ProjectMachine): Promise<void> {
    if (!machine) return;
    const key = projectMachineKey(machine);
    this.io(machine);
    let pending = this.prepared.get(key);
    if (!pending) {
      pending = importLegacyWslHost(this.store, this.wsl.get(key)!.transport, machine, this.transformImported);
      this.prepared.set(key, pending);
      void pending.catch(() => { if (this.prepared.get(key) === pending) this.prepared.delete(key); });
    }
    await pending;
  }
  forSession<T>(id: string, operation: () => T): T {
    const session = this.store.sessionIfExists(id);
    return session ? this.run(this.store.project(session.projectId).machine, operation) : operation();
  }
  async forRequest<T>(method: string, params: Record<string, unknown>, operation: () => Promise<T>): Promise<T> {
    // Catalogs/settings/auth are owned by the desktop irrespective of selected project.
    if (/^(?:models|providerAccounts|preferences|titleModel|nativeSources)\./.test(method)) return this.run(undefined, operation);
    // Reading Windows-owned history must work with the distribution stopped.
    // Live workspace enrichment requires a prepared execution connection.
    const hostOwned = /^(?:environment\.|notes\.|attachments\.|events\.|workspaces\.|connections\.|projects\.list$|sessions\.(?:activity|list|get|sync|syncChunk|update|nativeAccess|delete)$)/.test(method);
    const command = params.command && typeof params.command === "object" ? params.command as Record<string, unknown> : params;
    const projectId = typeof command.projectId === "string" ? command.projectId : typeof params.projectId === "string" ? params.projectId : undefined;
    const sessionId = typeof command.sessionId === "string" ? command.sessionId : undefined;
    if (projectId) { const machine = this.store.project(projectId).machine; if (!hostOwned) await this.prepare(machine); return this.run(machine, operation); }
    if (sessionId) {
      const session = this.store.sessionIfExists(sessionId);
      if (session && !hostOwned) await this.prepare(this.store.project(session.projectId).machine);
      return this.forSession(sessionId, operation);
    }
    if (params.machine !== undefined && !["projects.open", "projects.browse", "workspace.run"].includes(method)) throw new Error("This operation does not accept an execution machine");
    const machine = parseProjectMachine(params.machine);
    await this.prepare(machine);
    return this.run(machine, operation);
  }
  providers(providers: Partial<Record<RemoteProvider, HostProvider>>): Partial<Record<RemoteProvider, HostProvider>> {
    return Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, new Proxy(provider, {
      get: (target, property) => {
        const value = Reflect.get(target, property);
        if (typeof value !== "function" || property === "generateBranchName") return value;
        return (...args: unknown[]) => {
          const first = args[0];
          const id = typeof first === "string" ? first : first && typeof first === "object" && "sessionId" in first ? String(first.sessionId) : undefined;
          const invoke = () => {
            const io = currentMachineIO();
            // Uploads and generated images belong to the Host. Only their process
            // view changes: Linux providers must receive the mounted data path.
            if (["send", "steer", "compact"].includes(String(property)) && io.key !== "local" && first && typeof first === "object") {
              return (async () => {
                const prepared = { ...first } as Record<string, unknown>;
                if ("attachments" in first && Array.isArray(first.attachments)) prepared.attachments = await Promise.all(first.attachments.map(async (file: { path?: string }) => ({
                  ...file, ...(file.path ? { path: await io.hostPath(file.path) } : {}),
                })));
                const context = prepared.botContext as HarnessBotContext | undefined;
                if (context) {
                  const launcher = await wslControlLauncher(io);
                  prepared.botContext = { ...context,
                    ...(context.controlCli ? { controlCli: { command: launcher } } : {}),
                    ...(context.agentsMcp?.args.at(-1) === "agents-mcp" ? { agentsMcp: {
                      ...context.agentsMcp, command: await io.nodePath(),
                      args: [io.path.join(io.path.dirname(io.path.dirname(await io.nodePath())), "control-cli.mjs"), "agents-mcp"],
                    } } : {}),
                  };
                }
                return Reflect.apply(value, target, [prepared, ...args.slice(1)]);
              })();
            }
            return Reflect.apply(value, target, args);
          };
          return id ? this.forSession(id, invoke) : invoke();
        };
      },
    })]));
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.wsl.values()].map(async ({ backend, connection }) => {
      try { await backend.close(); } finally { await connection.close(); }
    }));
    for (const key of this.wsl.keys()) removeChildBackend(key);
    this.wsl.clear();
  }
}
