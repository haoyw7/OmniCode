import { remoteRequest } from "../connections/model/connections";
import { sharedHostMachineId, sharedHostEnvironment } from "../connections/model/remoteProjects";
import { loadRemoteHostDescriptor } from "../connections/model/remoteHostMetadata";
import { translate } from "../../shared/i18n/language";

export async function notesHostRequest<T>(method: "notes.list" | "notes.get" | "notes.upsert" | "notes.delete" | "notes.image" | "notes.saveImage", params?: Record<string, unknown>): Promise<T> {
  const machineId = sharedHostMachineId();
  if (!machineId) throw new Error(translate("Shared conversation service is not connected"));
  const descriptor = await loadRemoteHostDescriptor(machineId, sharedHostEnvironment() ?? "");
  if (!descriptor.capabilities.includes("notes.v1")) throw new Error(translate("Update Host to use shared notes."));
  return remoteRequest<T>(machineId, method, params);
}

const images = new Map<string, string>();
export async function resolveHostNoteImage(asset: string): Promise<string> {
  const key = `${sharedHostMachineId() ?? ""}:${asset}`;
  const cached = images.get(key);
  if (cached) return cached;
  const image = await notesHostRequest<{ mime: string; data: string }>("notes.image", { asset });
  const url = `data:${image.mime};base64,${image.data}`;
  images.set(key, url);
  return url;
}
