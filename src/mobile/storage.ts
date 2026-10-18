import { Capacitor, registerPlugin } from "@capacitor/core";

export type StorageKey = "connection" | "connections" | "pending" | "installationId";
export interface MobileStorage {
  get(key: StorageKey): Promise<string | null>;
  set(key: StorageKey, value: string): Promise<void>;
  remove(key: StorageKey): Promise<void>;
}
interface CredentialsPlugin {
  get(options: { key: StorageKey }): Promise<{ value?: string }>;
  set(options: { key: StorageKey; value: string }): Promise<void>;
  remove(options: { key: StorageKey }): Promise<void>;
}
const credentials = registerPlugin<CredentialsPlugin>("MonoCodeCredentials");

// Development browser connections are deliberately ephemeral. Device tokens
// never enter localStorage, Preferences, URLs, or the compiled application.
const memory = new Map<StorageKey, string>();
export const mobileStorage: MobileStorage = {
  async get(key) {
    if (!Capacitor.isNativePlatform()) return memory.get(key) ?? null;
    return (await credentials.get({ key })).value ?? null;
  },
  async set(key, value) {
    if (!Capacitor.isNativePlatform()) {
      memory.set(key, value);
      return;
    }
    await credentials.set({ key, value });
  },
  async remove(key) {
    if (!Capacitor.isNativePlatform()) {
      memory.delete(key);
      return;
    }
    await credentials.remove({ key });
  },
};
