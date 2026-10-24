import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { providerLaunch, resolveProvider } from "./process";
import { harnessLoginArgs } from "../src/integrations/harness/core/authSupport";
import type { HostLoginProvider, HostProviderLoginStatus } from "../src/contracts/providerLogin";

type Job = HostProviderLoginStatus & { provider: HostLoginProvider; child?: ChildProcess; timer?: ReturnType<typeof setTimeout> };
type Launch = (provider: HostLoginProvider, args: readonly string[]) => Promise<ChildProcess>;
const providers = new Set<string>(["cursor", "grok", "fx"]);

async function launchProviderLogin(provider: HostLoginProvider, args: readonly string[]): Promise<ChildProcess> {
  const launch = await providerLaunch(await resolveProvider(provider), []);
  const env = { ...process.env };
  delete env.OMNICODE_CONTROL_TOKEN;
  delete env.OMNICODE_APP_TOKEN;
  return spawn(launch.command, [...launch.args, ...args], {
    cwd: homedir(), env, stdio: "ignore", windowsHide: true,
  });
}

/** Owns the entire login lifetime, independent of any connected webview. */
export class HostProviderLogin {
  private readonly jobs = new Map<string, Job>();
  private readonly path: string;
  private closed = false;

  constructor(directory: string, private readonly launch: Launch = launchProviderLogin) {
    this.path = join(directory, "provider-login.json");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let saved: unknown;
    try { saved = JSON.parse(readFileSync(this.path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (saved != null) {
      if (!Array.isArray(saved)) throw new Error("Invalid provider sign-in journal");
      for (const row of saved) {
        if (!row || typeof row.id !== "string" || !providers.has(row.provider)
          || !["running", "succeeded", "failed"].includes(row.status)) throw new Error("Invalid provider sign-in journal");
        this.jobs.set(row.id, { id: row.id, provider: row.provider, status: row.status === "running" ? "failed" : row.status,
          ...(row.status === "running" ? { error: "Sign-in was interrupted; start it again" } : typeof row.error === "string" ? { error: row.error } : {}) });
      }
    }
  }

  private persist(): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.jobs.values()].map(({ id, provider, status, error }) => ({ id, provider, status, error }))), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  async start(params: Record<string, unknown>): Promise<HostProviderLoginStatus> {
    const { provider, operationId: id } = params;
    if (this.closed) throw new Error("Host stopped");
    if (typeof provider !== "string" || !providers.has(provider)) throw new Error("This provider does not offer a single browser sign-in flow");
    if (typeof id !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(id)) throw new Error("Invalid sign-in operation ID");
    if (params.accountId != null && params.accountId !== "default") throw new Error("This provider does not support named sign-in profiles");
    const current = this.jobs.get(id);
    if (current) {
      if (current.provider !== provider) throw new Error("Sign-in operation ID was reused with different input");
      return this.status({ id });
    }
    if ([...this.jobs.values()].some(job => job.provider === provider && job.status === "running")) throw new Error("Provider sign-in is already running");
    const job: Job = { id, provider: provider as HostLoginProvider, status: "running" };
    this.jobs.set(id, job);
    try { this.persist(); } catch (error) { this.jobs.delete(id); throw error; }
    try {
      const child = await this.launch(job.provider, harnessLoginArgs(job.provider)!);
      if (this.closed || job.status !== "running") { child.kill(); return this.status({ id }); }
      job.child = child;
      child.once("error", () => this.finish(job, "failed", "Could not start provider sign-in"));
      child.once("exit", code => this.finish(job, code === 0 ? "succeeded" : "failed", code === 0 ? undefined : "Provider sign-in failed"));
      job.timer = setTimeout(() => this.finish(job, "failed", "Provider sign-in timed out"), 10 * 60_000);
      job.timer.unref();
    } catch { this.finish(job, "failed", "Could not start provider sign-in"); }
    return this.status({ id });
  }

  status(params: Record<string, unknown>): HostProviderLoginStatus {
    const job = this.jobs.get(String(params.id));
    if (!job) throw new Error("Sign-in was interrupted; start it again");
    return { id: job.id, status: job.status, ...(job.error ? { error: job.error } : {}) };
  }

  private finish(job: Job, status: Job["status"], error?: string): void {
    if (job.status !== "running") return;
    job.status = status;
    job.error = error;
    if (job.timer) clearTimeout(job.timer);
    if (job.child && job.child.exitCode === null) job.child.kill();
    // The running receipt was already persisted before spawn. Even if final
    // persistence fails, restart reports interruption without launching again.
    try { this.persist(); } catch { /* Keep the live terminal status readable. */ }
  }

  close(): void {
    this.closed = true;
    for (const job of this.jobs.values()) this.finish(job, "failed", "Host stopped");
  }
}
