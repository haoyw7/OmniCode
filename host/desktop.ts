import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { HostStore } from "./store";
import { importDesktopSessions } from "./desktop-import";
import { readLegacyRetirementManifest } from "./legacy-orchestration";

/** Used only by the native desktop bootstrap. Its credential never reaches JS. */
export async function prepareDesktopHost(
  directory: string,
  desktopDirectory: string,
  entry: string,
  port: number,
  retirementManifestPath?: string,
  providerBinaryPaths: unknown = {},
) {
  const retirement = retirementManifestPath
    ? readLegacyRetirementManifest(retirementManifestPath, desktopDirectory)
    : undefined;
  const runningPath = join(directory, "running.json");
  const alive = async () => {
    if (!existsSync(runningPath)) return false;
    const state = JSON.parse(readFileSync(runningPath, "utf8"));
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/lifecycle`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.secret}`,
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: '{"action":"status"}',
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return false;
      const status = (await response.json()) as {
        sharedDesktop?: number;
        orchestrationHost?: number;
        nativeSessionAccess?: number;
        nativeSessionManager?: number;
        imHost?: number;
      };
      return status.sharedDesktop === 2 && status.orchestrationHost === 1 && status.nativeSessionAccess === 1 &&
        status.nativeSessionManager === 1 && status.imHost === 1
        ? "shared" : "legacy";
    } catch {
      return false;
    }
  };
  const initial = await alive();
  if (initial === "legacy") {
    const old = new HostStore(join(directory, "host.db"));
    old.db.exec("BEGIN IMMEDIATE");
    try {
      // Keep the write lease until shutdown: another device cannot accept a
      // new turn between the idle check and restarting the old executable.
      if ((await alive()) === "legacy") {
        const activeOrchestration = old.db.prepare("SELECT state FROM orchestration_runs").all()
          .some((row) => JSON.parse(String(row.state)).status === "active");
        if (old.sessions().some((value) => value.status === "running") || activeOrchestration)
          throw new Error(
            "Finish the running Host conversations before upgrading shared desktop access, then retry.",
          );
        const state = JSON.parse(readFileSync(runningPath, "utf8"));
        let stopped = false;
        try {
          const response = await fetch(
            `http://127.0.0.1:${state.port}/lifecycle`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${state.secret}`,
                "Content-Type": "application/json",
                Connection: "close",
              },
              body: '{"action":"stop"}',
              signal: AbortSignal.timeout(3_000),
            },
          );
          stopped = response.ok;
        } catch {
          /* Shutdown can close its response socket. */
        }
        if (!stopped && (await alive()) === "legacy")
          throw new Error("Could not update the shared conversation service");
        for (
          let attempt = 0;
          existsSync(runningPath) && attempt < 100;
          attempt++
        ) {
          const current = JSON.parse(readFileSync(runningPath, "utf8"));
          if (current.pid !== state.pid && (await alive()) === "shared") break;
          await new Promise((done) => setTimeout(done, 100));
        }
        if (existsSync(runningPath) && (await alive()) !== "shared")
          throw new Error("The old conversation service has not stopped yet");
      }
    } finally {
      old.db.exec("ROLLBACK");
      old.close();
    }
  }
  // Existing Hosts re-read this snapshot when discovering or launching a CLI.
  const ownerPath = join(directory, "desktop-owner.json");
  const temporaryOwner = `${ownerPath}.${randomUUID()}.tmp`;
  writeFileSync(
    temporaryOwner,
    JSON.stringify({ desktopDirectory, providerBinaryPaths }),
    { mode: 0o600 },
  );
  renameSync(temporaryOwner, ownerPath);
  if (!(await alive())) {
    const started = spawnSync(
      process.execPath,
      [entry, "start", "--data-dir", directory, "--port", String(port), "--listen-adapters"],
      { encoding: "utf8", timeout: 25_000, windowsHide: true },
    );
    // A second desktop window may have started the same Host concurrently.
    if (!(await alive()))
      throw new Error(
        started.stderr || "Could not start shared conversation service",
      );
  }
  {
    // The desktop's Host serves paired phones, even when it was started
    // without --listen-adapters. Older Hosts reject the action until restarted.
    const state = JSON.parse(readFileSync(runningPath, "utf8"));
    await fetch(`http://127.0.0.1:${state.port}/lifecycle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.secret}`, "Content-Type": "application/json", Connection: "close" },
      body: '{"action":"listenAdapters"}',
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
  }
  if (retirement) {
    const state = JSON.parse(readFileSync(runningPath, "utf8"));
    const response = await fetch(`http://127.0.0.1:${state.port}/lifecycle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.secret}`, "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ action: "retireLegacyOrchestration", manifest: retirement }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Could not retire legacy orchestration conversations; retry startup");
    const result = await response.json() as { retired?: boolean; error?: string };
    if (!result.retired) throw new Error(result.error ?? "Legacy orchestration cleanup was not accepted");
  }
  const store = new HostStore(join(directory, "host.db"));
  try {
    importDesktopSessions(store, join(desktopDirectory, "omnicode.db"));
    const credentialPath = join(
      desktopDirectory,
      "shared-host-credential.json",
    );
    let device = existsSync(credentialPath)
      ? (JSON.parse(readFileSync(credentialPath, "utf8")) as {
          id: string;
          token: string;
        })
      : undefined;
    if (!device || !store.authenticated(device.token)) {
      device = store.issueDevice("OmniCode desktop");
      writeFileSync(credentialPath, JSON.stringify(device), { mode: 0o600 });
    }
    store.markAdminDevice(device.id);
    const state = JSON.parse(readFileSync(runningPath, "utf8"));
    const sessions: { id: string; cwd: string; projectId?: string; deleted?: boolean }[] = store.db
      .prepare(
        "SELECT s.id, p.cwd, p.id AS project_id FROM sessions s JOIN projects p ON s.project_id=p.id",
      )
      .all()
      .map((row) => ({ id: String(row.id), cwd: String(row.cwd), projectId: String(row.project_id) }));
    for (const retired of retirement?.entries ?? []) {
      if (!sessions.some((row) => row.id === retired.id))
        sessions.push({ id: retired.id, cwd: retired.cwd ?? "~", deleted: true });
    }
    const legacyPath = join(desktopDirectory, "omnicode.db");
    if (existsSync(legacyPath)) {
      const sourceKey = createHash("sha256")
        .update(resolve(legacyPath))
        .digest("hex");
      const legacy = new DatabaseSync(legacyPath, { readOnly: true });
      try {
        for (const row of legacy
          .prepare("SELECT id, cwd FROM sessions")
          .all()) {
          if (
            !sessions.some((value) => value.id === row.id) &&
            typeof row.cwd === "string" &&
            !row.cwd.startsWith("remote://") &&
            store.db
              .prepare("SELECT 1 FROM metadata WHERE key=?")
              .get(`desktop-import:${sourceKey}:${row.id}`)
          )
            sessions.push({ id: String(row.id), cwd: row.cwd, deleted: true });
        }
      } finally {
        legacy.close();
      }
    }
    return {
      endpoint: `http://127.0.0.1:${state.port}`,
      token: device.token,
      environmentId: store.environmentId,
      projects: store.projects(),
      sessions,
    };
  } finally {
    store.close();
  }
}
