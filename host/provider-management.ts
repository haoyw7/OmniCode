import { execFile } from "node:child_process";
import { access, lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { providerLaunch, resolveProvider, installedProviderPaths } from "./process";
import { ProviderNpmInstallation } from "./provider-npm-installation";
import { ensureProviderRuntime, findManagedProviderRuntime, providerRuntimePlatform } from "./provider-runtime";
import { isRemoteProvider } from "../src/contracts/provider";
import type { RemoteProvider } from "../src/contracts/provider";
import type { HarnessBinaryInspection, HarnessCliPlan, HarnessInstall, ProviderMutationStatus } from "../src/contracts/providerRuntime";

const execute = promisify(execFile);
const packages: Partial<Record<RemoteProvider, string>> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex", deepseek: "@deepseek-ai/dsh", opencode: "opencode-ai", pi: "@earendil-works/pi-coding-agent" };
const updates: Partial<Record<RemoteProvider, string[]>> = { claude: ["update"], codex: ["update"], opencode: ["upgrade"], pi: ["update", "--self"] };
const canonical = (path: string) => realpath(path).catch(() => resolve(path));
const inside = (path: string, parent: string) => { const rel = relative(parent, path); return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
type Removal = { kind: "npm"; installation: ProviderNpmInstallation } | { kind: "native"; launchers: string[]; directory: string };

export function providerInstallSource(path: string): Pick<HarnessInstall, "source" | "bundledBy"> {
  const normalized = path.replace(/\\/g, "/"), lower = normalized.toLowerCase();
  if (lower.includes("/openai/codex/bin/")) return { source: "bundled", bundledBy: "Codex" };
  if (lower.includes("/claude/claude-code/")) return { source: "bundled", bundledBy: "Claude" };
  if (lower.includes("/node_modules/")) return { source: "npm", bundledBy: null };
  if (["/cellar/", "/homebrew/", "/linuxbrew/"].some(marker => lower.includes(marker))) return { source: "homebrew", bundledBy: null };
  const parts = normalized.split("/").filter(Boolean);
  const app = parts.find(part => /\.app$/i.test(part));
  const resource = parts.findIndex(part => part.toLowerCase() === "resources");
  const owner = app?.slice(0, -4) ?? (resource >= 0 ? parts.slice(0, resource).reverse().find(part => part.toLowerCase() !== "app") : undefined);
  return owner ? { source: "bundled", bundledBy: /^(chatgpt|codex|claude)$/i.test(owner) ? ({ chatgpt: "ChatGPT", codex: "Codex", claude: "Claude" } as Record<string, string>)[owner.toLowerCase()] : owner } : { source: "other", bundledBy: null };
}

export function providerInstallSpec(provider: RemoteProvider, windows = process.platform === "win32"): { command: string; script: string } {
  if (["deepseek", "codex", "opencode", "pi"].includes(provider)) {
    const packageName = provider === "deepseek" ? "@deepseek-ai/dsh@0.2.1-rc.2" : packages[provider]!;
    const flags = provider === "pi" ? " --ignore-scripts" : "";
    return windows ? {
      command: `npm install -g${flags} ${packageName}`,
      script: `$ErrorActionPreference = 'Stop'; if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Install Node.js with npm, then retry.' }; & npm.cmd install --global --no-audit --no-fund${flags} ${packageName}; exit $LASTEXITCODE`,
    } : {
      command: `npm install -g --prefix ~/.npm-global${flags} ${packageName}`,
      script: `command -v npm >/dev/null || { echo 'Install Node.js with npm, then retry.' >&2; exit 1; }; npm install --global --prefix "$HOME/.npm-global" --no-audit --no-fund${flags} ${packageName}`,
    };
  }
  const scripts: Partial<Record<RemoteProvider, [string, string]>> = windows ? {
    claude: ["https://claude.ai/install.ps1", ""], cursor: ["https://cursor.com/install?win32=true", ""], grok: ["https://x.ai/cli/install.ps1", ""], omp: ["https://omp.sh/install.ps1", "-Binary"], hermes: ["https://hermes-agent.nousresearch.com/install.ps1", "-NonInteractive"],
  } : {
    claude: ["https://claude.ai/install.sh", ""], cursor: ["https://cursor.com/install", ""], grok: ["https://x.ai/cli/install.sh", ""], omp: ["https://omp.sh/install", "--binary"], fx: ["https://fx.sh/setup.sh", ""], hermes: ["https://hermes-agent.nousresearch.com/install.sh", "--non-interactive"],
  };
  const spec = scripts[provider];
  if (!spec) throw new Error("Automatic installation is not available for this agent on this platform.");
  const [url, args] = spec;
  return windows ? {
    command: `& ([scriptblock]::Create((irm '${url}'))) ${args}`.trimEnd(),
    script: `$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create((Invoke-RestMethod -Uri '${url}'))) ${args}`,
  } : { command: `curl -fsSL ${url} | bash${args ? ` -s -- ${args}` : ""}`, script: `curl --fail --silent --show-error --location '${url}' | bash -s -- ${args}` };
}

/** The Host owns CLI discovery and mutations; all external input stays data. */
export class HostProviderManagement {
  private claimed = false;
  private readonly jobs = new Map<string, ProviderMutationStatus & { signature: string }>();
  private busy = false;
  private readonly journal: string;
  constructor(private readonly directory: string, private readonly activeBinary: (provider: RemoteProvider) => Promise<string> = resolveProvider) {
    this.journal = join(directory, "provider-runtime-operations.json");
    if (existsSync(this.journal)) {
      const saved: unknown = JSON.parse(readFileSync(this.journal, "utf8"));
      if (!Array.isArray(saved)) throw new Error("Invalid CLI operation journal");
      for (const row of saved) {
        if (!row || typeof row.id !== "string" || typeof row.signature !== "string" || !["running", "succeeded", "failed"].includes(row.status)) throw new Error("Invalid CLI operation journal");
        this.jobs.set(row.id, { id: row.id, signature: row.signature, status: row.status === "running" ? "failed" : row.status,
          ...(row.status === "running" ? { error: "CLI operation was interrupted; inspect the installation before retrying." } : typeof row.error === "string" ? { error: row.error } : {}) });
      }
    }
  }
  private provider(value: unknown): RemoteProvider { if (!isRemoteProvider(value)) throw new Error("Invalid provider"); return value; }
  private async binary(provider: RemoteProvider, requested?: unknown): Promise<string> {
    if (requested == null || requested === "") return requested === undefined ? this.activeBinary(provider) : resolveProvider(provider);
    if (typeof requested !== "string" || !isAbsolute(requested) || !(await stat(requested)).isFile()) throw new Error("Invalid configured CLI path");
    await providerLaunch(requested, []);
    return requested;
  }
  private async version(path: string): Promise<string> {
    const launch = await providerLaunch(path, ["--version"]);
    const { stdout } = await execute(launch.command, launch.args, { timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    if (!/\d+\.\d+\.\d+/.test(stdout)) throw new Error("CLI returned no valid version.");
    return stdout.trim();
  }
  async inspect(params: Record<string, unknown>): Promise<HarnessBinaryInspection> {
    const provider = this.provider(params.provider), path = await this.binary(provider, params.binaryPath);
    if (provider === "antigravity") return { path, version: "ACP server" };
    try { return { path, version: await this.version(path) }; }
    catch (error) { return { path, error: error instanceof Error ? error.message : String(error) }; }
  }
  async latest(params: Record<string, unknown>): Promise<string> {
    const provider = this.provider(params.provider), packageName = packages[provider];
    if (!updates[provider] || !packageName) throw new Error(`No update feed for harness: ${provider}`);
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, { headers: { Accept: "application/json", "User-Agent": "OmniCode" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`npm registry request failed (${response.status})`);
    const value = await response.json() as { version?: unknown };
    if (typeof value.version !== "string" || !value.version.trim()) throw new Error("npm registry returned no version");
    return value.version.trim();
  }
  claim(): boolean { const first = !this.claimed; this.claimed = true; return first; }
  async info(params: Record<string, unknown>): Promise<HarnessInstall> {
    const provider = this.provider(params.provider), path = await this.binary(provider, params.binaryPath), realPath = await canonical(path);
    const source = providerInstallSource(realPath);
    if (packages[provider] && await ProviderNpmInstallation.find(path, packages[provider]!)) source.source = "npm";
    const seen = new Set([realPath]), alternatives: HarnessInstall["alternatives"] = [];
    for (const candidate of await installedProviderPaths(provider)) {
      const real = await canonical(candidate);
      if (seen.has(real) || providerInstallSource(real).source === "bundled") continue;
      seen.add(real);
      try { alternatives.push({ path: candidate, version: await this.version(candidate) }); } catch { /* A broken copy cannot be offered. */ }
    }
    return { path, realPath, ...source, alternatives };
  }
  private async removal(provider: RemoteProvider, launcher: string): Promise<Removal> {
    const real = await canonical(launcher), source = providerInstallSource(real);
    if (source.source === "bundled") throw new Error("This CLI is bundled with another app and is removed with that app.");
    if (packages[provider]) { const installation = await ProviderNpmInstallation.find(launcher, packages[provider]!); if (installation) return { kind: "npm", installation }; }
    const folder = provider === "claude" ? "claude" : provider === "cursor" ? "cursor-agent" : undefined;
    if (folder) {
      const bin = join(homedir(), ".local", "bin"), directory = join(homedir(), ".local", "share", folder);
      if ((await stat(directory).catch(() => null))?.isDirectory() && await canonical(dirname(launcher)) === await canonical(bin)) {
        const data = await canonical(directory);
        if (inside(real, data) || (process.platform === "win32" && provider === "claude" && real === await canonical(launcher))) {
          const launchers = new Set([launcher]);
          for (const name of await readdir(bin)) { const path = join(bin, name); if ((await lstat(path)).isSymbolicLink() && inside(await canonical(path), data)) launchers.add(path); }
          return { kind: "native", launchers: [...launchers], directory };
        }
      }
    }
    throw new Error(source.source === "homebrew" ? "This CLI was installed with Homebrew. Remove it with brew uninstall." : "OmniCode can remove only CLIs installed with npm or the official installer. Remove this copy manually.");
  }
  async plan(params: Record<string, unknown>): Promise<HarnessCliPlan> {
    const provider = this.provider(params.provider);
    let installCommand: string | null = null;
    try { installCommand = providerInstallSpec(provider).command; } catch { /* Manual installation only. */ }
    const plan: HarnessCliPlan = { installCommand, path: null, removes: [], uninstallCommand: null, uninstallBlocker: null };
    try { plan.path = await this.binary(provider, params.binaryPath); } catch { return plan; }
    try {
      const removal = await this.removal(provider, plan.path);
      if (removal.kind === "npm") { plan.removes = [removal.installation.root]; plan.uninstallCommand = `npm uninstall -g --prefix ${JSON.stringify(removal.installation.prefix)} ${removal.installation.packageName}`; }
      else plan.removes = [...removal.launchers, removal.directory];
    } catch (error) { plan.uninstallBlocker = error instanceof Error ? error.message : String(error); }
    return plan;
  }
  private async run(command: string, args: string[], timeout: number): Promise<void> {
    try { await execute(command, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) { const value = error as { stderr?: string; stdout?: string; message?: string }; throw new Error((value.stderr || value.stdout || value.message || "CLI operation failed.").trim().slice(-4000)); }
  }
  private async mutate(action: string, params: Record<string, unknown>): Promise<void> {
    const provider = this.provider(params.provider);
    if (action === "install") {
      try { await resolveProvider(provider); return; } catch { /* Install only an absent CLI. */ }
      const script = providerInstallSpec(provider).script;
      await this.run(process.platform === "win32" ? "powershell.exe" : "bash", process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", script] : ["-o", "pipefail", "-c", script], 15 * 60_000);
      await this.version(await resolveProvider(provider));
      return;
    }
    const path = await this.binary(provider, params.binaryPath);
    if (action === "update") {
      const args = updates[provider];
      if (!args) throw new Error(`No updater for harness: ${provider}`);
      const source = providerInstallSource(await canonical(path));
      if (source.source === "bundled") throw new Error(`This CLI is bundled with ${source.bundledBy ?? "another app"} (${path}) and only updates with that app.`);
      const managed = await findManagedProviderRuntime(provider);
      if (managed && await canonical(managed.command) === await canonical(path)) {
        const next = await ensureProviderRuntime(provider, "latest", providerRuntimePlatform());
        await this.version(next.command);
        return;
      }
      const update = async () => { const launch = await providerLaunch(path, args); await this.run(launch.command, launch.args, 5 * 60_000); };
      const verify = () => this.version(path);
      const installation = packages[provider] ? await ProviderNpmInstallation.find(path, packages[provider]!) : undefined;
      if (installation) await installation.update(update, verify);
      else { if (source.source === "npm") throw new Error("Cannot safely back up this npm installation"); await update(); await verify(); }
      return;
    }
    if (action !== "uninstall") throw new Error("Invalid CLI operation");
    const removal = await this.removal(provider, path);
    if (removal.kind === "npm") {
      const args = ["uninstall", "--global", "--no-audit", "--no-fund", "--prefix", removal.installation.prefix, removal.installation.packageName];
      if (process.platform === "win32") {
        // Fixed executable; each argument is data, quoted independently for PowerShell.
        const script = `& npm.cmd ${args.map(arg => `'${arg.replace(/'/g, "''")}'`).join(" ")}; exit $LASTEXITCODE`;
        await this.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 5 * 60_000);
      } else await this.run("npm", args, 5 * 60_000);
      try { await access(removal.installation.root); } catch { return; }
      throw new Error("npm finished, but the CLI package is still installed.");
    }
    for (const launcher of removal.launchers) await rm(launcher, { force: true });
    await rm(removal.directory, { recursive: true });
  }
  private persist(): void { mkdirSync(this.directory, { recursive: true, mode: 0o700 }); const tmp = `${this.journal}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify([...this.jobs.values()]), { mode: 0o600 }); renameSync(tmp, this.journal); }
  start(params: Record<string, unknown>): ProviderMutationStatus {
    const provider = this.provider(params.provider), id = params.operationId, action = params.action;
    if (typeof id !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(id) || !["install", "update", "uninstall"].includes(String(action))) throw new Error("Invalid CLI operation");
    if (params.binaryPath !== undefined && params.binaryPath !== null && typeof params.binaryPath !== "string") throw new Error("Invalid configured CLI path");
    const signature = JSON.stringify([action, provider, params.binaryPath ?? null]), previous = this.jobs.get(id);
    if (previous) { if (previous.signature !== signature) throw new Error("CLI operation ID was reused with different input"); return this.status({ id }); }
    if (this.busy) throw new Error("Another CLI installation, update or removal is already running.");
    const job: ProviderMutationStatus & { signature: string } = { id, signature, status: "running" };
    this.jobs.set(id, job);
    try { this.persist(); } catch (error) { this.jobs.delete(id); throw error; }
    this.busy = true;
    void this.mutate(String(action), params).then(() => { job.status = "succeeded"; }, error => { job.status = "failed"; job.error = error instanceof Error ? error.message : String(error); }).finally(() => { this.busy = false; try { this.persist(); } catch { /* The durable running receipt prevents replay after restart. */ } });
    return this.status({ id });
  }
  status(params: Record<string, unknown>): ProviderMutationStatus { const job = this.jobs.get(String(params.id)); if (!job) throw new Error("CLI operation is no longer available"); return { id: job.id, status: job.status, ...(job.error ? { error: job.error } : {}) }; }
}
