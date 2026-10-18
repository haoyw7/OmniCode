import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { access, readFile, readlink, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join, basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import { isWindowsDesktopProviderPath, resolveWindowsDesktopProvider } from "./windows-provider-cli";
import {
  ensureProviderRuntime,
  findManagedProviderRuntime,
  parseProviderVersion,
  providerRuntimePlatform,
  supportsProviderRuntime,
  retainProviderRuntime,
  type ProviderPlatform,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeOptions,
} from "./provider-runtime";

/** npm packages whose Windows .cmd shims MonoCode launches, by shim name. */
const npmPackages: Record<string, string[]> = {
  codex: ["@openai/codex"],
  claude: ["@anthropic-ai/claude-code"],
  opencode: ["opencode-ai", "@opencode/cli"],
  "pi-coding-agent": [
    "@earendil-works/pi-coding-agent",
    "@mariozechner/pi-coding-agent",
  ],
  pi: ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"],
};

const binaryNames: Record<RemoteProvider, string[]> = {
  codex: ["codex"],
  claude: ["claude"],
  cursor: ["cursor-agent", "agent"],
  grok: ["grok"],
  opencode: ["opencode"],
  pi: ["pi-coding-agent", "pi"],
  omp: ["omp"],
  fx: ["fx"],
  hermes: ["hermes"],
  antigravity: ["agy_acp_server.par"],
};

const providerDirectories = (provider: RemoteProvider): string[] => {
  const home = homedir();
  const extra: Partial<Record<RemoteProvider, string[]>> = {
    claude: [
      join(home, ".claude", "local"),
      join(home, ".local", "share", "claude"),
    ],
    grok: [join(home, ".grok", "bin")],
    opencode: [join(home, ".opencode", "bin")],
    pi: [join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "bin")],
    fx: [join(home, ".fx", "bin")],
    hermes: [
      join(home, ".hermes", "hermes-agent", "venv", "bin"),
      join(home, ".hermes", "hermes-agent", ".venv", "bin"),
    ],
    antigravity: [join(home, ".local", "share", "agy-acp")],
  };
  return [
    ...new Set([
      ...(process.env.PATH ?? "").split(delimiter),
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".cargo", "bin"),
      join(home, "n", "bin"),
      join(home, ".bun", "bin"),
      ...(extra[provider] ?? []),
      ...(process.platform === "win32"
        ? [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "npm")]
        : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin"]),
    ]),
  ];
};

async function matchesProvider(
  candidate: string,
  provider: RemoteProvider,
  name: string,
): Promise<boolean> {
  if (provider === "cursor" && name === "agent") {
    try {
      if ((await readlink(candidate)).toLowerCase().includes("cursor-agent"))
        return true;
    } catch {
      /* not a symlink */
    }
    return fileContains(candidate, ["cursor-agent"], 64 * 1024);
  }
  if (provider === "pi" && name === "pi")
    return (
      (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate) &&
        await npmBinMatches(await npmBinEntry(candidate, "pi"), npmPackages.pi)) ||
      (await npmBinMatches(candidate, [
        "@earendil-works/pi-coding-agent",
        "@mariozechner/pi-coding-agent",
      ])) ||
      fileContains(
        candidate,
        [
          "pi-coding-agent",
          "@earendil-works/pi",
          "@mariozechner/pi-coding-agent",
          "pi_coding_agent",
        ],
        64 * 1024,
      )
    );
  if (provider === "fx")
    return fileContains(candidate, [
      "vercel-labs/fx",
      "fx_model",
      "createfxagent",
      "fx acp",
    ]);
  return true;
}

// Pi 1.x's npm executable is a tiny forwarding module without a provider name
// in its contents. Check the package's declared bin target without executing it.
async function npmBinMatches(
  candidate: string,
  names: string[],
): Promise<boolean> {
  const target = await realpath(candidate);
  let directory = dirname(target);
  for (let depth = 0; depth < 6; depth++) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (names.includes(manifest.name)) {
        const entries =
          typeof manifest.bin === "string"
            ? [manifest.bin]
            : Object.values(manifest.bin ?? {});
        for (const entry of entries) {
          if (
            typeof entry === "string" &&
            (await realpath(join(directory, entry))) === target
          )
            return true;
        }
        return false;
      }
    } catch {
      /* keep checking the bounded package ancestry */
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}

async function fileContains(
  path: string,
  markers: string[],
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<boolean> {
  let read = 0;
  let carry = "";
  for await (const chunk of createReadStream(path, {
    highWaterMark: 64 * 1024,
  })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const length = Math.min(bytes.length, maxBytes - read);
    const text = (
      carry + bytes.subarray(0, length).toString("latin1")
    ).toLowerCase();
    if (markers.some((marker) => text.includes(marker))) return true;
    carry = text.slice(-64);
    read += length;
    if (read >= maxBytes) break;
  }
  return false;
}

async function resolveInstalledProvider(
  provider: RemoteProvider,
): Promise<string> {
  const windows = process.platform === "win32";
  const bundled: string[] = [];
  if (windows && provider === "antigravity")
    throw new Error("Antigravity ACP is not available on Windows");
  for (const directory of providerDirectories(provider)) {
    if (!directory) continue;
    for (const name of binaryNames[provider]) {
      for (const extension of windows
        ? [".exe", ".cmd", ".bat", ".com"]
        : [""]) {
        const candidate = join(
          directory.replace(/^"|"$/g, ""),
          name + extension,
        );
        try {
          await access(candidate, windows ? constants.F_OK : constants.X_OK);
          if (!(await stat(candidate)).isFile()) continue;
          await providerLaunch(candidate, []);
          if (!(await matchesProvider(candidate, provider, name))) continue;
          if (windows && (provider === "codex" || provider === "claude")) {
            // A desktop GUI executable can have exactly the CLI's filename.
            try {
              if ((await stat(join(dirname(candidate), "resources/app.asar"))).isFile()) continue;
            } catch { /* not an Electron launcher */ }
            if (isWindowsDesktopProviderPath(await realpath(candidate))) {
              bundled.push(candidate);
              continue;
            }
          }
          return candidate;
        } catch {
          /* try the next installed launcher */
        }
      }
    }
  }
  if (bundled.length) return bundled[0];
  const desktop = await resolveWindowsDesktopProvider(provider);
  if (desktop) return desktop;
  throw new Error(
    `${provider} is not installed on this host or is missing from its PATH. Install its native CLI or standard npm package.`,
  );
}

/** Discovery stays offline; desktop-owned Hosts may explicitly request installation. */
export async function resolveProvider(provider: RemoteProvider): Promise<string> {
  try { return await resolveInstalledProvider(provider); } catch (error) {
    if (supportsProviderRuntime(provider)) {
      const managed = await findManagedProviderRuntime(provider);
      if (managed) { await retainProviderRuntime(managed); return managed.command; }
    }
    throw error;
  }
}

export interface ResolvedProviderRuntime {
  provider: RemoteProvider;
  version: string;
  command: string;
  source: "configured" | "path" | "managed";
  platform: ProviderPlatform;
  installation?: ProviderRuntimeArtifact;
}

export interface ResolveProviderRuntimeOptions extends ProviderRuntimeOptions {
  configuredPath?: string;
  installMissing?: boolean;
  platform?: ProviderPlatform;
  /** Install this exact managed version; used for the matching WSL artifact. */
  version?: string;
}

export async function resolveProviderRuntime(provider: RemoteProvider, options: ResolveProviderRuntimeOptions = {}): Promise<ResolvedProviderRuntime> {
  const platform = options.platform ?? providerRuntimePlatform();
  if (options.version) {
    const installation = await ensureProviderRuntime(provider, options.version, platform, options);
    await retainProviderRuntime(installation);
    return { provider, platform, version: installation.version, command: installation.command, source: "managed", installation };
  }
  let command = options.configuredPath;
  let source: ResolvedProviderRuntime["source"] = command ? "configured" : "path";
  if (command) {
    if (!isAbsolute(command) || !(await stat(command)).isFile()) throw new Error(`Invalid configured ${provider} CLI path`);
  } else {
    try { command = await resolveInstalledProvider(provider); } catch (error) {
      const cached = await findManagedProviderRuntime(provider, platform, options);
      const installation = cached ?? (options.installMissing
        ? await ensureProviderRuntime(provider, "latest", platform, options)
        : undefined);
      if (!installation) throw error;
      await retainProviderRuntime(installation);
      return { provider, platform, version: installation.version, command: installation.command, source: "managed", installation };
    }
  }
  const launch = await providerLaunch(command, ["--version"]);
  const output = await promisify(execFile)(launch.command, launch.args, {
    timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  const version = parseProviderVersion(`${output.stdout}\n${output.stderr}`);
  if (platform !== providerRuntimePlatform()) {
    const installation = await ensureProviderRuntime(provider, version, platform, options);
    await retainProviderRuntime(installation);
    source = "managed";
    return { provider, platform, version, command: installation.command, source, installation };
  }
  return { provider, platform, version, command, source };
}

/** The executable an npm package declares for `name`, beside its .cmd shim.
 * Packages move between a JS entry (`cli.js`) and a native `.exe`, so follow
 * the manifest instead of a fixed path. */
async function npmBinEntry(shim: string, name: string): Promise<string> {
  if (name === "pi" && basename(dirname(shim)).toLowerCase() === "bin") {
    const install = join(dirname(dirname(shim)), "install");
    try {
      const version = (await readFile(join(install, "current-version"), "utf8")).trim();
      if (/^[0-9][0-9A-Za-z._+-]*$/.test(version)) {
        const root = join(install, "releases", version, "node_modules", "@earendil-works/pi-coding-agent");
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
        if (pkg.name === "@earendil-works/pi-coding-agent" && typeof entry === "string" &&
            !entry.split(/[\\/]/).includes("..") && !isAbsolute(entry) && (await stat(join(root, entry))).isFile())
          return join(root, entry);
      }
    } catch { /* Try a standard npm shim next. */ }
  }
  for (const pkg of npmPackages[name] ?? []) {
    const root = join(dirname(shim), "node_modules", ...pkg.split("/"));
    let manifest: { bin?: unknown };
    try {
      manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const bin = manifest.bin;
    const relative =
      typeof bin === "string"
        ? bin
        : bin && typeof bin === "object"
          ? (bin as Record<string, unknown>)[name]
          : undefined;
    if (typeof relative !== "string") continue;
    const entry = join(root, relative);
    if (!(await stat(entry)).isFile())
      throw new Error("Missing npm provider entry point");
    return entry;
  }
  throw new Error("Unsupported Windows provider launcher");
}

/** npm's Windows .cmd wrappers cannot be spawned directly. Run their package's
 * declared entry point (JS with the bundled Node, or a native .exe), preserving
 * argv without a shell. Custom .cmd/.bat wrappers are deliberately not
 * interpreted as shell text. */
export async function providerLaunch(
  command: string,
  args: string[],
  platform = process.platform,
): Promise<{ command: string; args: string[] }> {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const entry = await npmBinEntry(
      command,
      basename(command, extname(command)).toLowerCase(),
    );
    if (/\.exe$/i.test(entry)) return { command: entry, args };
    if (!/\.(cjs|mjs|js)$/i.test(entry))
      throw new Error("Unsupported Windows provider launcher");
    return { command: process.execPath, args: [entry, ...args] };
  }
  if (/\.(cjs|mjs|js)$/i.test(command))
    return { command: process.execPath, args: [command, ...args] };
  return { command, args };
}
