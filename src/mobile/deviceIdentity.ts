import type { MobileStorage } from "./storage";

const identities = new WeakMap<MobileStorage, Promise<string | undefined>>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One identity per app installation, independent of Hosts, addresses and credentials. */
export function readMobileInstallationId(storage: MobileStorage): Promise<string | undefined> {
  const existing = identities.get(storage);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const saved = await storage.get("installationId");
      if (saved && UUID.test(saved)) return saved.toLowerCase();
      const id = crypto.randomUUID();
      // Persist before sending it: a failed write must not create a transient identity.
      await storage.set("installationId", id);
      return id;
    } catch (error) {
      identities.delete(storage);
      // Older native shells reject the new key. They retain legacy pairing until updated.
      if (error instanceof Error && error.message === "Invalid storage key") return undefined;
      throw error;
    }
  })();
  identities.set(storage, pending);
  return pending;
}
