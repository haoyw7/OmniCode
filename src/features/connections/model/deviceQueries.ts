import { queryOptions } from "@tanstack/react-query";
import { remoteRequest } from "./connections";
import type { HostDeviceInfo } from "./protocol";

export type HostDevice = Omit<HostDeviceInfo, "installationId"> & {
  id: string;
  name: string;
  admin: boolean;
  createdAt?: number;
  pairedAt?: number;
  lastSeen?: number;
  online?: boolean;
  identityId?: string;
  connectionIds?: string[];
};

export const hostDevicesQuery = (machineId: string) => queryOptions({
  queryKey: ["connections", "devices", machineId] as const,
  queryFn: ({ signal }) => {
    signal.throwIfAborted();
    return remoteRequest<{ devices: HostDevice[] }>(machineId, "devices.list");
  },
});
