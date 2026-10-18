import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { providerLaunch, resolveProvider } from "./process";
import { claudeUsageKeychainService } from "./claude-usage";
import { desktopProviderAccounts, providerUsageProfile, ACCOUNT_PROVIDERS } from "./provider-accounts";
import type { HostProviderAccounts } from "../src/features/connections/model/protocol";

type Provider = (typeof ACCOUNT_PROVIDERS)[number];
type Profile = { id: string; label: string; dataHome?: string; managedHome?: boolean };
type AccountState = {
  revision: number;
  accounts: Partial<Record<Provider, Profile[]>>;
  defaults: Partial<Record<Provider, string>>;
  operations: Record<string, string>;
};
export type HostAccountSnapshot = { revision: number; accounts: HostProviderAccounts; defaults: Partial<Record<Provider, string>> };
type LoginStatus = { id: string; status: "running" | "succeeded" | "failed"; error?: string };
type LoginJob = LoginStatus & { provider: Provider; accountId: string; child?: ChildProcess; timer?: ReturnType<typeof setTimeout> };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider account configuration");
  return value as Record<string, unknown>;
}
function json(path: string): Record<string, unknown> { return object(JSON.parse(readFileSync(path, "utf8"))); }
function optionalJson(path: string): Record<string, unknown> {
  try { return json(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
function homePath(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid provider account Data Home");
  const text = value.trim();
  const path = text === "~" ? homedir() : /^~[/\\]/.test(text) ? join(homedir(), text.slice(2)) : text;
  if (!isAbsolute(path)) throw new Error("Data Home must be an absolute path or start with ~/");
  return path;
}
function canonical(path: string): string { try { return realpathSync(path); } catch { return path; } }

/** Preserve provider endpoints and other CLI configuration when isolating auth.
 * Change only a simple root-level credentials-store assignment. Ambiguous TOML
 * needs an explicit sign-in rather than silently changing authentication scope. */
function importedCodexConfig(source: string): string {
  let config: string;
  try { config = readFileSync(join(source, "config.toml"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 'cli_auth_credentials_store = "file"\n'; throw error; }
  const lines = config.split(/\r?\n/);
  const header = lines.findIndex(line => /^\s*\[/.test(line));
  const end = header < 0 ? lines.length : header;
  for (let index = 0; index < end; index++) {
    const line = lines[index];
    if (/^[^#]*(?:"""|''')/.test(line))
      throw new Error("Sign in to a named account to use this Codex credential store");
    if (/^\s*(?:cli_auth_credentials_store|"cli_auth_credentials_store"|'cli_auth_credentials_store')\s*=/.test(line)) {
      if (!/^\s*(?:cli_auth_credentials_store|"cli_auth_credentials_store"|'cli_auth_credentials_store')\s*=\s*(?:"[^"\\]*"|'[^']*')\s*(?:#.*)?$/.test(line))
        throw new Error("The current Codex config.toml is invalid");
      lines[index] = "";
    }
  }
  return 'cli_auth_credentials_store = "file"\n' + lines.join("\n");
}

/** One Host-owned document commits metadata, defaults, and operation receipts together.
 * Credentials stay in CLI Homes, including legacy/custom directory references. */
export class HostAccountManagement {
  private readonly path: string;
  private readonly owner: string;
  private jobs = new Map<string, LoginJob>();
  private starts = new Map<string, Promise<LoginStatus>>();
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string,
    private readonly beforeRemove: (provider: Provider, accountId: string) => Promise<void> = async () => {}) {
    this.path = join(directory, "provider-accounts", "state.json");
    this.owner = join(directory, "desktop-owner.json");
  }

  private state(): AccountState {
    if (existsSync(this.path)) {
      const state = json(this.path);
      if (!Number.isSafeInteger(state.revision) || !state.accounts || !state.defaults || !state.operations)
        throw new Error("Invalid Host account configuration");
      return state as AccountState;
    }
    // The shared desktop directory already contains release's committed account
    // metadata. Read it once; a webview cache never participates in this import.
    const desktop = optionalJson(this.owner).desktopDirectory;
    const source = typeof desktop === "string" ? desktop : this.directory;
    const legacy = optionalJson(join(source, "provider-accounts", "accounts.json"));
    const defaults = optionalJson(join(source, "provider-accounts", "defaults.json"));
    const state: AccountState = { revision: 1, accounts: {}, defaults: {}, operations: {} };
    for (const provider of ACCOUNT_PROVIDERS) {
      const entries: Profile[] = [];
      for (const value of Array.isArray(legacy[provider]) ? legacy[provider] : []) {
        const entry = object(value);
        if (!validId(entry.id) || typeof entry.label !== "string" || !entry.label.trim())
          throw new Error("Invalid provider account configuration");
        const custom = homePath(entry.dataHome);
        entries.push({ id: entry.id, label: entry.label.trim().slice(0, 80),
          ...(custom ? { dataHome: custom } : entry.id !== "default"
            ? { dataHome: join(source, "provider-accounts", provider, entry.id), managedHome: true } : {}) });
      }
      // Preserve profiles whose login finished before the legacy UI saved a row.
      try {
        for (const entry of readdirSync(join(source, "provider-accounts", provider), { withFileTypes: true })) {
          if (!entry.isDirectory() || !validId(entry.name) || entry.name === "default" || entries.some(row => row.id === entry.name)
            || existsSync(join(source, "provider-accounts", "removed", provider, entry.name))) continue;
          entries.push({ id: entry.name, label: entry.name, dataHome: join(source, "provider-accounts", provider, entry.name), managedHome: true });
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!entries.some(entry => entry.id === "default")) entries.unshift({ id: "default", label: "Default account" });
      state.accounts[provider] = entries;
      const preferred = defaults[provider];
      if (preferred !== undefined) {
        if (!validId(preferred)) throw new Error("Invalid shared account defaults");
        if (preferred !== "default") state.defaults[provider] = preferred;
      }
    }
    this.write(state);
    return state;
  }

  private write(state: AccountState): void {
    mkdirSync(join(this.directory, "provider-accounts"), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally { rmSync(temporary, { force: true }); }
  }

  read(): HostAccountSnapshot {
    const state = this.state();
    return { revision: state.revision, accounts: desktopProviderAccounts(this.owner), defaults: { ...state.defaults } };
  }

  private input(params: Record<string, unknown>): { provider: Provider; accountId: string } {
    if (!ACCOUNT_PROVIDERS.includes(params.provider as Provider) || !validId(params.accountId)) throw new Error("Invalid provider account");
    return { provider: params.provider as Provider, accountId: params.accountId };
  }
  private existing(state: AccountState, provider: Provider, id: string): Profile {
    const entry = state.accounts[provider]?.find(entry => entry.id === id);
    if (!entry) throw new Error("This provider account is no longer available");
    return entry;
  }
  private mutate(kind: string, params: Record<string, unknown>, mutation: (state: AccountState, provider: Provider, id: string) => void | (() => void)): HostAccountSnapshot {
    const { provider, accountId } = this.input(params);
    const operationId = params.operationId;
    if (typeof operationId !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(operationId)) throw new Error("Invalid account operation ID");
    const signature = JSON.stringify([kind, provider, accountId, params.label ?? null, params.dataHome ?? null]);
    const state = this.state();
    if (state.operations[operationId]) {
      if (state.operations[operationId] !== signature) throw new Error("Account operation ID was reused with different input");
      return this.read();
    }
    const rollback = mutation(state, provider, accountId);
    state.operations[operationId] = signature;
    state.revision++;
    try { this.write(state); } catch (error) { rollback?.(); throw error; }
    return this.read();
  }

  save(params: Record<string, unknown>): HostAccountSnapshot {
    return this.mutate("save", params, (state, provider, id) => {
      if (typeof params.label !== "string" || !params.label.trim()) throw new Error("An account label is required");
      const current = state.accounts[provider]?.find(entry => entry.id === id);
      // Omitted Home preserves the Host's private selector; null/empty resets it.
      const home = params.dataHome === undefined ? current?.dataHome : homePath(params.dataHome);
      const profile: Profile = { id, label: params.label.trim().slice(0, 80), ...(home ? { dataHome: home } : {}),
        ...(params.dataHome === undefined && current?.managedHome ? { managedHome: true } : {}) };
      if (home || id !== "default") mkdirSync(home ?? join(this.directory, "provider-accounts", provider, id), { recursive: true, mode: 0o700 });
      state.accounts[provider] = [...(state.accounts[provider] ?? []).filter(entry => entry.id !== id), profile];
    });
  }

  setDefault(params: Record<string, unknown>): HostAccountSnapshot {
    return this.mutate("default", params, (state, provider, id) => {
      this.existing(state, provider, id);
      if (id === "default") delete state.defaults[provider];
      else state.defaults[provider] = id;
    });
  }

  remove(params: Record<string, unknown>): Promise<HostAccountSnapshot> {
    const next = this.serial.catch(() => {}).then(async () => {
      const { provider, accountId } = this.input(params);
      if (accountId === "default") throw new Error("The default provider account cannot be removed");
      const state = this.state();
      if (!state.operations[String(params.operationId)]) {
        this.existing(state, provider, accountId);
        if (state.defaults[provider] === accountId) throw new Error("Choose another shared default before removing this account");
        for (const job of this.jobs.values()) if (job.provider === provider && job.accountId === accountId) this.finish(job, "failed", "Account removed");
        await this.beforeRemove(provider, accountId);
      }
      return this.mutate("remove", params, (latest, provider, id) => {
        if (latest.defaults[provider] === id) throw new Error("Choose another shared default before removing this account");
        const entry = this.existing(latest, provider, id);
        const home = entry.dataHome ?? join(this.directory, "provider-accounts", provider, id);
        const owned = !entry.dataHome || entry.managedHome;
        const referenced = ACCOUNT_PROVIDERS.some(other => latest.accounts[other]?.some(row => {
          if (other === provider && row.id === id) return false;
          const path = row.dataHome ?? (row.id === "default"
            ? other === "codex" ? process.env.CODEX_HOME || join(homedir(), ".codex") : process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
            : join(this.directory, "provider-accounts", other, row.id));
          return canonical(path) === canonical(home) || canonical(path).startsWith(canonical(home) + sep);
        }));
        if (owned && !referenced) {
          if (provider === "claude" && process.platform === "darwin") {
            try { execFileSync("security", ["delete-generic-password", "-s", claudeUsageKeychainService(home)], { stdio: "ignore", timeout: 5_000 }); }
            catch (error) { if ((error as { status?: number }).status !== 44) throw new Error("Could not remove account keychain credentials"); }
          }
          rmSync(home, { recursive: true, force: true });
        }
        latest.accounts[provider] = latest.accounts[provider]!.filter(entry => entry.id !== id);
      });
    });
    this.serial = next;
    return next;
  }

  importCodex(params: Record<string, unknown>): HostAccountSnapshot {
    return this.mutate("import", { ...params, provider: "codex" }, (state, provider, id) => {
      if (id === "default" || state.accounts[provider]?.some(entry => entry.id === id)) throw new Error("The destination account already exists");
      if (typeof params.label !== "string" || !params.label.trim()) throw new Error("An account label is required");
      const source = providerUsageProfile(this.owner, "codex", "default").home;
      const config = importedCodexConfig(source);
      const raw = readFileSync(join(source, "auth.json"), "utf8");
      const auth = object(JSON.parse(raw));
      const tokens = auth.tokens && typeof auth.tokens === "object" ? auth.tokens as Record<string, unknown> : {};
      if (!(typeof tokens.refresh_token === "string" && tokens.refresh_token) && !(typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY))
        throw new Error("The current Codex CLI profile has no importable credentials");
      const destination = join(this.directory, "provider-accounts", "codex", id);
      // Exclusive directory creation prevents retry/error cleanup touching existing data.
      mkdirSync(join(this.directory, "provider-accounts", "codex"), { recursive: true, mode: 0o700 });
      mkdirSync(destination, { mode: 0o700 });
      try {
        writeFileSync(join(destination, "auth.json"), raw, { flag: "wx", mode: 0o600 });
        writeFileSync(join(destination, "config.toml"), config, { flag: "wx", mode: 0o600 });
        state.accounts.codex = [...(state.accounts.codex ?? []), { id, label: params.label.trim().slice(0, 80) }];
        return () => rmSync(destination, { recursive: true, force: true });
      } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
    });
  }

  loginStart(params: Record<string, unknown>): Promise<LoginStatus> {
    const { provider, accountId } = this.input(params);
    const id = params.operationId;
    if (typeof id !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(id)) throw new Error("Invalid account operation ID");
    const state = this.state();
    this.existing(state, provider, accountId);
    const current = this.jobs.get(id);
    if (current) {
      if (current.provider !== provider || current.accountId !== accountId) throw new Error("Account operation ID was reused with different input");
      return Promise.resolve(this.loginStatus({ id }));
    }
    const pending = this.starts.get(id);
    if (pending) return pending;
    // A lost client reply or Host restart must never start a second OAuth flow.
    if (state.operations[id]) throw new Error("Sign-in was interrupted; start it again");
    this.mutate("login", params, () => {});
    const active = [...this.jobs.values()].find(job => job.provider === provider && job.accountId === accountId && job.status === "running");
    if (active) {
      this.jobs.set(id, active);
      return Promise.resolve(this.loginStatus({ id }));
    }
    const job: LoginJob = { id, provider, accountId, status: "running" };
    this.jobs.set(id, job);
    const start = (async () => {
      const profile = providerUsageProfile(this.owner, provider, accountId);
      mkdirSync(profile.home, { recursive: true, mode: 0o700 });
      const binary = await resolveProvider(provider);
      if (job.status !== "running") return this.loginStatus({ id });
      const launch = await providerLaunch(binary, []);
      const env = { ...process.env };
      for (const key of ["MONOCODE_CONTROL_TOKEN", "MONOCODE_APP_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[key];
      if (provider === "codex") env.CODEX_HOME = profile.home;
      else if (profile.keychainSelector) {
        env.CLAUDE_CONFIG_DIR = profile.keychainSelector;
        env.CLAUDE_SECURESTORAGE_CONFIG_DIR = profile.keychainSelector;
      }
      const args = provider === "codex" ? ["login"] : ["auth", "login"];
      job.child = spawn(launch.command, [...launch.args, ...args], { cwd: homedir(), env, stdio: "ignore", windowsHide: true });
      job.child.once("error", () => this.finish(job, "failed", "Could not start provider sign-in"));
      job.child.once("exit", code => this.finish(job, code === 0 ? "succeeded" : "failed", code === 0 ? undefined : "Provider sign-in failed"));
      job.timer = setTimeout(() => this.finish(job, "failed", "Provider sign-in timed out"), 10 * 60_000);
      job.timer.unref();
      return this.loginStatus({ id });
    })().catch(error => { this.finish(job, "failed", "Could not start provider sign-in"); throw error; }).finally(() => this.starts.delete(id));
    this.starts.set(id, start);
    return start;
  }

  loginStatus(params: Record<string, unknown>): LoginStatus {
    const job = this.jobs.get(String(params.id));
    if (!job) throw new Error("Sign-in was interrupted; start it again");
    return { id: job.id, status: job.status, ...(job.error ? { error: job.error } : {}) };
  }
  private finish(job: LoginJob, status: LoginStatus["status"], error?: string): void {
    if (job.status !== "running") return;
    job.status = status; job.error = error;
    if (job.timer) clearTimeout(job.timer);
    if (job.child && job.child.exitCode === null) job.child.kill();
  }
  close(): void { for (const job of this.jobs.values()) this.finish(job, "failed", "Host stopped"); }
}
