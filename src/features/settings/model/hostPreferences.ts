import { flushPreferenceAssets, migrateLegacyPreferenceBackgrounds, registerPreferenceAssetHost } from "./preferenceAssets";
import { activatePreferenceStore, activePreferenceStore, adoptDeviceLocalPreferences, SharedPreferenceStore, type PreferenceCodec, type PreferenceRequest } from "./sharedPreferences";
import { hostStateTransportUnavailable } from "../../connections/model/hostStateOffline";

export type HostPreferenceConnection = {
  hostId: string;
  request: PreferenceRequest;
  capabilities: readonly string[];
  codec?: PreferenceCodec;
  importRelease?: boolean;
};
let generation = 0;
/** Bind a verified identity, never an endpoint alone. A stale response cannot activate another Host. */
export async function connectHostPreferences(options: HostPreferenceConnection): Promise<() => void> {
  const epoch = ++generation;
  registerPreferenceAssetHost(options.hostId, options.request);
  const request: PreferenceRequest = async (method, params) => {
    if (!options.capabilities.includes("clientState.v1")) throw new Error("Update Host to share settings.");
    if (method === "preferences.patch") await flushPreferenceAssets(options.hostId, options.request);
    return options.request(method, params);
  };
  const store = new SharedPreferenceStore(options.hostId, localStorage, request, options.codec);
  activatePreferenceStore(store);
  const sync = () => { if (epoch === generation) void store.sync(); };
  if (options.importRelease) await store.importRelease(key => localStorage.getItem(key));
  else await store.sync();
  if (epoch !== generation) return () => {};
  adoptDeviceLocalPreferences(store, !!options.codec);
  const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") sync(); }, 2000);
  const onStorage = (event: StorageEvent) => { if (event.key?.startsWith(store.journalPrefix)) sync(); };
  window.addEventListener("focus", sync);
  window.addEventListener("online", sync);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", sync);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", sync);
    window.removeEventListener("online", sync);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", sync);
    if (activePreferenceStore() === store) { ++generation; activatePreferenceStore(undefined); }
  };
}

let desktopCleanup: (() => void) | undefined;
export const desktopProjectPreferenceStores = new Map<string, SharedPreferenceStore>();
export function stopDesktopHostPreferences(): void {
  desktopCleanup?.();
  desktopCleanup = undefined;
}
export async function initializeHostPreferences() {
  stopDesktopHostPreferences();
  const [
    { sharedHostEnvironment, sharedHostMachineId, rememberRemoteProject, sharedProjects },
    { remoteRequest, REMOTE_MACHINES_CHANGED },
    { loadRemoteHostDescriptor }, { createProjectPreferenceCodec },
    { configureProjectPreferenceStores, flushProjectPreferenceStaging, routeGet, routeSet },
    { setPreferenceRouting, SHARED_PREFERENCES_CHANGED },
    { PROJECT_MAP_PREFERENCES, PROJECT_LIST_PREFERENCES, validateSharedPreferenceValue }, { invoke },
  ] = await Promise.all([
    import("../../connections/model/remoteProjects"), import("../../connections/model/connections"),
    import("../../connections/model/remoteHostMetadata"), import("./projectPreferenceCodec"),
    import("./projectPreferenceRouting"), import("./sharedPreferences"),
    import("./sharedPreferenceSchema"), import("@tauri-apps/api/core"),
  ]);
  const hostId = sharedHostEnvironment();
  const machineId = sharedHostMachineId();
  if (!hostId || !machineId) throw new Error("Shared conversation service is not connected");
  let capabilities: readonly string[];
  try {
    capabilities = (await loadRemoteHostDescriptor(machineId, hostId)).capabilities;
  } catch (error) {
    const cached = localStorage.getItem(`monocode.hostPreferences.v1:${hostId}`);
    if (!cached || !hostStateTransportUnavailable(error)) throw error;
    capabilities = ["clientState.v1"];
  }
  const stopPrimary = await connectHostPreferences({ hostId,
    request: (method, params) => remoteRequest(machineId, method, params),
    capabilities, codec: createProjectPreferenceCodec(), importRelease: false });
  const primary = activePreferenceStore();
  if (!primary || primary.hostId !== hostId) { stopPrimary(); return; }
  const stores = desktopProjectPreferenceStores;
  stores.clear();
  stores.set(hostId, primary);
  const machineBindings = new Map<string, string>([[hostId, machineId]]);
  const cleanups = new Map<string, () => void>();
  let live = true;
  let machinesRequest: Promise<void> | undefined;
  const announce = (keys: string[]) => {
    for (const key of keys) window.dispatchEvent(new StorageEvent("storage", { key }));
    window.dispatchEvent(new CustomEvent(SHARED_PREFERENCES_CHANGED, { detail: keys }));
  };
  const configure = () => {
    configureProjectPreferenceStores(primary, stores);
    setPreferenceRouting({ get: routeGet, set: routeSet });
  };
  const refreshMachines = (): Promise<void> => {
    if (machinesRequest) return machinesRequest;
    machinesRequest = (async () => {
      const machines = await invoke<import("../../connections/model/protocol").RemoteMachine[]>("remote_machines");
      if (!live) return;
      const present = new Set(machines.map((entry) => entry.environmentId));
      for (const id of stores.keys()) if (id !== hostId && !present.has(id)) {
        cleanups.get(id)?.(); cleanups.delete(id); stores.delete(id); machineBindings.delete(id);
      }
      for (const machine of machines) {
        if (machine.environmentId === hostId) continue;
        if (stores.has(machine.environmentId) && machineBindings.get(machine.environmentId) !== machine.id) {
          cleanups.get(machine.environmentId)?.();
          cleanups.delete(machine.environmentId);
          stores.delete(machine.environmentId);
        }
        if (stores.has(machine.environmentId)) continue;
        let verified = false;
        const rawRequest: PreferenceRequest = async (method, params) => {
          if (!verified) {
            const remote = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
            if (!remote.capabilities.includes("clientState.v1")) throw new Error("Update Host to share settings.");
            // Resolve project IDs into this device's remote path representation.
            const projects = await remoteRequest<import("../../connections/model/protocol").HostProject[]>(machine.id, "projects.list");
            verified = true;
            if (live) for (const project of projects) rememberRemoteProject(machine.environmentId, project);
          }
          if (!live) throw new Error("Host settings connection was closed");
          return remoteRequest(machine.id, method, params);
        };
        registerPreferenceAssetHost(machine.environmentId, rawRequest);
        const request: PreferenceRequest = async (method, params) => {
          if (method === "preferences.patch") await flushPreferenceAssets(machine.environmentId, rawRequest);
          return rawRequest(method, params);
        };
        const store = new SharedPreferenceStore(machine.environmentId, localStorage, request, createProjectPreferenceCodec());
        stores.set(machine.environmentId, store);
        machineBindings.set(machine.environmentId, machine.id);
        cleanups.set(machine.environmentId, store.subscribe(announce));
        void store.sync();
      }
      configure();
      announce([...PROJECT_MAP_PREFERENCES]);
    })().finally(() => { machinesRequest = undefined; });
    return machinesRequest;
  };
  const disposeStores = () => {
    live = false;
    stopPrimary();
    for (const cleanup of cleanups.values()) cleanup();
    stores.clear();
    configureProjectPreferenceStores(undefined);
    setPreferenceRouting(undefined);
  };
  try {
    await refreshMachines();
    if (!import.meta.env.DEV && !primary.imported && primary.revision >= 0) {
      // Every project choice is durable before the Host import marker advances.
      // The legacy source is retained untouched as a recovery copy.
      for (const key of [...PROJECT_MAP_PREFERENCES, ...PROJECT_LIST_PREFERENCES]) {
        const raw = localStorage.getItem(key);
        if (raw !== null && validateSharedPreferenceValue(key, raw)) routeSet(key, raw);
      }
      await migrateLegacyPreferenceBackgrounds();
      const { legacyAgentDefaults } = await import("./agentPreferences");
      await primary.importRelease((key) => PROJECT_MAP_PREFERENCES.has(key) || PROJECT_LIST_PREFERENCES.has(key) ? null
        : key === "monocode.agentDefaults" ? legacyAgentDefaults((key) => localStorage.getItem(key))
          : key === "monocode.chatBackgroundAsset" ? primary.getItem(key) ?? localStorage.getItem(key) : localStorage.getItem(key));
    }
    // Project discovery is a shared preference write. Bootstrap must not mutate
    // the retained legacy localStorage before the Host adapter is installed.
    const { knownProjectPaths, normalizeProjectPath, rememberProject, replaceProjectPath } = await import("../../projects/model/recents");
    const { parseWslUncPath, wslPath } = await import("../../../shared/lib/wslPaths");
    const { IS_WIN } = await import("../../../platform/tauri/platform");
    const projects = sharedProjects();
    // Older bootstrap versions remembered WSL cwd without its machine identity.
    // Repair only unambiguous matches on Windows; another distro or a local
    // project with the same cwd must never have its identity guessed.
    for (const path of knownProjectPaths()) {
      const unc = parseWslUncPath(path);
      const matches = IS_WIN ? projects.filter(project => normalizeProjectPath(project.cwd) === normalizeProjectPath(path)) : [];
      const replacement = unc ? wslPath(unc.machine.distribution, unc.hostPath)
        : matches.length === 1 && matches[0].machine?.kind === "wsl" ? matches[0].key : undefined;
      if (replacement) replaceProjectPath(path, replacement);
    }
    const known = new Set(knownProjectPaths().map(normalizeProjectPath));
    for (const project of projects) {
      if (!known.has(normalizeProjectPath(project.key))) rememberProject(project.key);
    }
  } catch (error) {
    disposeStores();
    throw error;
  }
  const syncAux = () => {
    if (!live || document.visibilityState === "hidden") return;
    for (const [id, store] of stores) if (id !== hostId) void store.sync();
    flushProjectPreferenceStaging();
  };
  const onMachines = () => { void refreshMachines().catch(() => undefined); };
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("monocode.hostPreferences.v1:")) syncAux();
  };
  const timer = window.setInterval(syncAux, 2_000);
  window.addEventListener(REMOTE_MACHINES_CHANGED, onMachines);
  window.addEventListener("focus", syncAux);
  window.addEventListener("online", syncAux);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", syncAux);
  desktopCleanup = () => {
    clearInterval(timer);
    disposeStores();
    window.removeEventListener(REMOTE_MACHINES_CHANGED, onMachines);
    window.removeEventListener("focus", syncAux);
    window.removeEventListener("online", syncAux);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", syncAux);
  };
}
