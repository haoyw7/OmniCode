import type { HostDeviceInfo } from "../contracts/protocol";

export type RequestOptions = { timeoutMs?: number; signal?: AbortSignal };

/** A target is an opaque platform connection handle; credentials stay in its adapter. */
export type HttpPort<Target> = {
  request<T>(target: Target, method: string, params: object, options?: RequestOptions): Promise<T>;
  key(target: Target): string;
};
export type OutboxStoragePort<Key extends string = string> = {
  get(key: Key): Promise<string | null>;
  set(key: Key, value: string): Promise<void>;
  remove(key: Key): Promise<void>;
};
export type LifecyclePort = {
  isActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
};
export type DevicePort = { read(): Promise<HostDeviceInfo | undefined> };

export type ClientPorts<Target> = {
  http: HttpPort<Target>;
  storage: OutboxStoragePort;
  lifecycle: LifecyclePort;
  device: DevicePort;
};
