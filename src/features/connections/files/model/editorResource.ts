import { remoteMachineFor, remoteRequest } from "../../model/connections";
import { parseRemotePath, sharedHostEnvironment, sharedHostMachineId } from "../../model/remoteProjects";
import { ownsLocalWorkspaceCommand } from "../../model/remoteCommands";
import type { HostDescriptor } from "../../../../contracts/protocol";
import { translate } from "../../../../shared/i18n/language";

const RELEASE_PREFIX = "omnicode.editor-resource-release.v1.";
type PendingRelease = { machineId: string; resourceId: string };
const pendingReleases = new Map<string, PendingRelease>();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let releaseFlight: Promise<void> | undefined;

function rememberRelease(value: PendingRelease) {
  pendingReleases.set(value.resourceId, value);
  try {
    localStorage.setItem(
      RELEASE_PREFIX + value.resourceId,
      JSON.stringify(value),
    );
  } catch {
    /* Keep this process's retry. */
  }
}
function forgetRelease(resourceId: string) {
  pendingReleases.delete(resourceId);
  try {
    localStorage.removeItem(RELEASE_PREFIX + resourceId);
  } catch {
    /* A repeated release is harmless. */
  }
}
function scheduleReleaseRetry() {
  if (!releaseTimer && pendingReleases.size)
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      void flushEditorResourceReleases();
    }, 5_000);
}

/** Explicit closes survive a disconnect and are replayed after reconnect/restart. */
export function flushEditorResourceReleases(): Promise<void> {
  if (releaseFlight) return releaseFlight;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(RELEASE_PREFIX)) continue;
      const value = JSON.parse(
        localStorage.getItem(key) ?? "null",
      ) as PendingRelease | null;
      if (
        value &&
        typeof value.machineId === "string" &&
        typeof value.resourceId === "string"
      )
        pendingReleases.set(value.resourceId, value);
    }
  } catch {
    /* Storage is optional; in-memory retries still protect this process. */
  }
  releaseFlight = Promise.allSettled(
    [...pendingReleases.values()].map(async (value) => {
      await remoteRequest(value.machineId, "resources.release", {
        resourceId: value.resourceId,
      });
      forgetRelease(value.resourceId);
    }),
  )
    .then(() => undefined)
    .finally(() => {
      releaseFlight = undefined;
      if (!pendingReleases.size) {
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
      scheduleReleaseRetry();
    });
  return releaseFlight;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushEditorResourceReleases();
  });
  window.addEventListener("omnicode:remote-machine-status", () => {
    void flushEditorResourceReleases();
  });
  void Promise.resolve().then(flushEditorResourceReleases);
}

export type EditorResource = {
  ready: Promise<void>;
  reclaim(): Promise<void>;
  release(): Promise<void>;
};

/** A mounted buffer keeps the owning Host from removing its worker checkout. */
export function claimEditorResource(path: string): EditorResource {
  const resourceId = `editor-${crypto.randomUUID()}`;
  let claimed = false;
  let attempted = false;
  let closed = false;
  let claim: (() => Promise<unknown>) | undefined;
  let release: (() => Promise<unknown>) | undefined;
  const ready = (async () => {
    let target: { machineId: string; hostPath: string } | undefined;
    const remote = parseRemotePath(path);
    if (remote) {
      const machine = await remoteMachineFor(remote.environmentId);
      if (machine) target = { machineId: machine.id, hostPath: remote.hostPath };
    } else {
      // Only registered projects and their worktrees have checkouts to protect.
      const machineId = sharedHostEnvironment() ? sharedHostMachineId() : undefined;
      if (machineId && ownsLocalWorkspaceCommand("read_text_file", { path }))
        target = { machineId, hostPath: path };
    }
    if (target) {
      const { machineId, hostPath } = target;
      const descriptor = await remoteRequest<HostDescriptor>(
        machineId,
        "environment.describe",
      );
      if (!descriptor.capabilities.includes("resources")) return;
      claim = () =>
        remoteRequest(machineId, "resources.claim", {
          resourceId,
          path: hostPath,
        });
      release = async () => {
        rememberRelease({ machineId, resourceId });
        try {
          await remoteRequest(machineId, "resources.release", { resourceId });
          forgetRelease(resourceId);
        } finally {
          scheduleReleaseRetry();
        }
      };
    }
    if (claim) {
      attempted = true;
      await claim();
      claimed = true;
    }
  })();
  let acquisition = ready;
  return {
    ready,
    reclaim: async () => {
      try {
        await acquisition;
      } catch (error) {
        if (!claim || closed) throw error;
        acquisition = Promise.resolve(claim()).then(() => {
          claimed = true;
        });
        await acquisition;
      }
      if (closed)
        throw new Error(translate("This editor buffer has been closed."));
      if (claimed) await claim?.();
    },
    release: async () => {
      if (closed) return;
      closed = true;
      try {
        await acquisition;
      } catch {
        /* An accepted claim may have lost its response. */
      }
      if (attempted) await release?.();
    },
  };
}
