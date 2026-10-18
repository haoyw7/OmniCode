import type { Session, LinkedWorkItem } from "../model/session";
import type { SessionSummary, SessionSearchHit } from "./sessionStore";
import type {
  NativeSessionAccess,
  NativeSourceListing,
} from "../../../integrations/harness/core/nativeSessions";

/** Host-managed native conversations. */
export type SharedNativeBackend = {
  /** Sources resolved by the Host; `autoSync` also updates the Host setting. */
  list(options?: { refresh?: boolean; autoSync?: boolean }): Promise<NativeSourceListing>;
  /** Imports (or returns the existing) Host conversation for a listed source. */
  import(sourceId: string): Promise<string>;
  /** Re-reads every managed conversation now. */
  syncAll(): Promise<void>;
  access(id: string): Promise<NativeSessionAccess | null>;
};

export type SharedSessionBackend = {
  ownsProject(cwd: string): boolean;
  ownsSession(id: string): boolean;
  rememberSession(id: string, cwd: string): void;
  native: SharedNativeBackend;
  list(cwd?: string): Promise<SessionSummary[]>;
  get(id: string): Promise<Session | null>;
  update(
    id: string,
    patch: {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      linkedWorkItem?: LinkedWorkItem | null;
    },
  ): Promise<void>;
  delete(id: string): Promise<void>;
  search(
    query: string,
    cwd?: string,
    includeArchived?: boolean,
    owner?: string,
  ): Promise<SessionSearchHit[]>;
  cancelSearch(owner: string): void;
};

let backend: SharedSessionBackend | undefined;
export const sharedSessionBackend = () => backend;
export function setSharedSessionBackend(value?: SharedSessionBackend) {
  backend = value;
}
