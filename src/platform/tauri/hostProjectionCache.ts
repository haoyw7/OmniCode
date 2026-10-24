import { invoke } from "@tauri-apps/api/core";
import type { HostSession } from "../../contracts/protocol";

/** Credentials and cache scope stay in native storage. Never use session_upsert. */
export const hostProjectionIdentity = (machineId: string): Promise<string> =>
  invoke("host_projection_cache_identity", { machineId });
export const saveHostProjection = (machineId: string, snapshot: HostSession, expectedScope: string): Promise<void> =>
  invoke("host_projection_cache_put", { machineId, snapshot, expectedScope });
export const loadHostProjection = (machineId: string, sessionId: string): Promise<HostSession | null> =>
  invoke("host_projection_cache_get", { machineId, sessionId });
export const listHostProjections = (machineId: string, projectId: string): Promise<HostSession[]> =>
  invoke("host_projection_cache_list", { machineId, projectId });
export const deleteHostProjection = (machineId: string, sessionId: string, expectedScope: string): Promise<void> =>
  invoke("host_projection_cache_delete", { machineId, sessionId, expectedScope });
export const cachedSharedHost = <T>(): Promise<T | null> => invoke("shared_host_cached_prepare");

