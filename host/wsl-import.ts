import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { projectMachineKey, type ProjectMachine } from "../src/integrations/harness/core/machine";
import { isRemoteProvider } from "../src/integrations/harness/core/provider";
import type { HostStore } from "./store";
import type { MachineTransport } from "./machine-io";

type HostSession = ReturnType<HostStore["session"]>;
type Transform = (value: HostSession) => HostSession;
const safeId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function copyExclusive(source: string, destination: string, replacement?: Buffer): Promise<void> {
  const existing = await readFile(destination).catch(error => { if (missing(error)) return undefined; throw error; });
  if (existing) {
    const original = replacement ?? await readFile(source);
    if (!createHash("sha256").update(existing).digest().equals(createHash("sha256").update(original).digest()))
      throw new Error("A migrated attachment conflicts with an existing attachment");
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  if (replacement) await writeFile(destination, replacement, { flag: "wx" });
  else await copyFile(source, destination, 1);
}

async function copyTreeExclusive(source: string, destination: string, machine: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyTreeExclusive(join(source, entry.name), join(destination, entry.name), machine);
    else if (entry.isFile()) {
      const path = join(source, entry.name);
      let replacement: Buffer | undefined;
      if (entry.name.endsWith(".json")) {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (value && typeof value === "object" && typeof value.cwd === "string")
          replacement = Buffer.from(JSON.stringify({ ...value, machine }));
      }
      await copyExclusive(path, join(destination, entry.name), replacement);
    }
    else throw new Error("Unsupported link in imported checkpoint data");
  }
}

/** Import an immutable snapshot; source rows and the source database are never altered. */
export async function importWslSnapshot(store: HostStore, path: string, machine: ProjectMachine,
  stagedData?: string, transform: Transform = value => value): Promise<{ projects: number; sessions: number }> {
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const identity = String(source.prepare("SELECT value FROM metadata WHERE key='environmentId'").get()?.value ?? "legacy");
    const sourceKey = createHash("sha256").update(`${projectMachineKey(machine)}:${identity}`).digest("hex");
    const projects = source.prepare("SELECT * FROM projects").all().filter(project => !project.kind);
    const projectIds = new Set(projects.map(project => String(project.id)));
    const rows = source.prepare("SELECT id,project_id,snapshot FROM sessions").all().filter(row => projectIds.has(String(row.project_id)));
    const pending = rows.flatMap(row => {
      const id = String(row.id);
      const marker = `wsl-import:${sourceKey}:${id}`;
      if (store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(marker)) return [];
      if (!safeId(id) || store.sessionIfExists(id) || store.isRetired(id)) throw new Error(`Conversation ID collision while importing WSL history: ${id}`);
      const value = JSON.parse(String(row.snapshot)) as HostSession;
      if (value.session?.id !== id || !isRemoteProvider(value.session.harness) || !Array.isArray(value.session.blocks) || !value.session.cwd?.startsWith("/"))
        throw new Error("Invalid legacy WSL conversation");
      return [{ id, marker, projectId: String(row.project_id), value }];
    });
    // Complete file copies before recording successful imports. A retry verifies
    // existing attachments and skips committed rows, including later deletions.
    if (stagedData && pending.length) {
      const attachments = join(stagedData, "attachments");
      for (const id of await readdir(attachments).catch(error => { if (missing(error)) return []; throw error; })) {
        if (!safeId(id)) throw new Error("Invalid imported attachment ID");
        const sourceFile = join(attachments, id);
        if ((await stat(sourceFile)).isFile()) await copyExclusive(sourceFile, join(store.attachmentDir, id));
      }
    }
    for (const row of pending) {
      if (!stagedData) continue;
      const checkpoints = join(stagedData, "checkpoints", row.id);
      if ((await stat(checkpoints).catch(error => { if (missing(error)) return undefined; throw error; }))?.isDirectory()) {
        const destination = join(dirname(store.databasePath), "checkpoints", row.id);
        await copyTreeExclusive(checkpoints, destination, projectMachineKey(machine));
      }
    }
    return store.transaction(() => {
      const mapped = new Map<string, string>();
      for (const project of projects) {
        const cwd = String(project.cwd);
        if (!posix.isAbsolute(cwd) || cwd.includes("\0")) throw new Error("Invalid legacy WSL project path");
        mapped.set(String(project.id), store.addProject(cwd, String(project.name), undefined, machine).id);
      }
      for (const { value, marker, projectId } of pending) {
        const worker = !!(value.session.orchestrationLeadId || value.session.workflowParentId);
        // Only conversation/checkpoint history is imported. Old schedulers and
        // their control receipts must never restart on a new Host identity.
        const session = { ...value.session, orchestrationLeadId: undefined, workflowParentId: undefined,
          workflowRunId: undefined, workflowRuns: undefined,
          ...(value.session.queuedMessages?.length ? { queueStatus: "paused" as const } : {}),
          blocks: value.session.blocks.map(block => block.orchestration || block.workflowRun ? {
            ...block, role: "system" as const, orchestration: undefined, workflowRun: undefined,
            text: [block.text, "```json", JSON.stringify({ orchestration: block.orchestration, workflowRun: block.workflowRun }, null, 2), "```"].filter(Boolean).join("\n"),
          } : block),
        };
        const imported = transform({ ...value, session, projectId: mapped.get(projectId)!, status: value.status === "running" ? "interrupted" : value.status,
          ...(worker ? { archived: true } : {}), runId: undefined, blockRevisions: undefined, revision: value.revision + 1 });
        // Attachment references become desktop-owned paths; IDs stay stable.
        const rewrite = (item: unknown): void => {
          if (!item || typeof item !== "object") return;
          if (Array.isArray(item)) { item.forEach(rewrite); return; }
          const data = item as Record<string, unknown>;
          if (typeof data.id === "string" && safeId(data.id) && typeof data.path === "string" && data.path.includes("/attachments/")) data.path = join(store.attachmentDir, data.id);
          Object.values(data).forEach(rewrite);
        };
        rewrite(imported.session);
        store.save(imported, { type: "session.wslImported", sourceKey });
        store.db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run(marker, imported.session.id);
      }
      return { projects: projects.length, sessions: pending.length };
    });
  } finally { source.close(); }
}

/** Stop the verified old Host, snapshot into Windows, and retain the original as backup. */
export async function importLegacyWslHost(store: HostStore, rpc: MachineTransport, machine: ProjectMachine, transform?: Transform) {
  const { home } = await rpc.request<{ home: string }>("env.info");
  const directory = posix.join(home, ".monocode/remote/data");
  const database = posix.join(directory, "host.db");
  try { await rpc.request("fs.stat", { path: database }); }
  catch (error) { if (missing(error)) return { projects: 0, sessions: 0 }; throw error; }
  const temporary = await mkdtemp(join(tmpdir(), "monocode-wsl-import-"));
  try {
    const converted = await rpc.request<{ stdout: string; code: number }>("exec", { command: "wslpath", args: ["-a", "-u", temporary], timeout: 10_000 });
    if (converted.code !== 0) throw new Error("Could not map the WSL import directory");
    const target = converted.stdout.trim();
    await rpc.request("legacy.stop", { directory });
    await rpc.request("db.snapshot", { path: database, destination: posix.join(target, "host.db") });
    for (const name of ["attachments", "checkpoints"]) {
      const path = posix.join(directory, name);
      try { await rpc.request("fs.stat", { path }); }
      catch (error) { if (missing(error)) continue; throw error; }
      await rpc.request("fs.cp", { path, destination: posix.join(target, name), recursive: true, errorOnExist: true });
    }
    return await importWslSnapshot(store, join(temporary, "host.db"), machine, temporary, transform);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
