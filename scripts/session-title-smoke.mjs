// Read-only native metadata probes. Never send prompts or print private titles.
import { build } from "esbuild";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(".");
const directory = await mkdtemp(join(tmpdir(), "monocode-title-smoke-"));
try {
  for (const binary of [
    "codex",
    "claude",
    "cursor-agent",
    "pi",
    "omp",
    "opencode",
    "grok",
    "fx",
    "hermes",
    "agy",
  ]) {
    try {
      const { stdout } = await run(binary, ["--version"], { timeout: 10_000 });
      console.log(`${binary}: ${stdout.trim().split("\n")[0]}`);
    } catch {
      console.log(`${binary}: unavailable on PATH`);
    }
  }
  const source = `
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configureChildBackend, acquireHarnessBridge } from ${JSON.stringify(join(root, "src/integrations/harness/core/child.ts"))};
import { HostChildBackend } from ${JSON.stringify(join(root, "host/child-backend.ts"))};
import { readCodexSessionTitle } from ${JSON.stringify(join(root, "src/integrations/harness/providers/codex/codex.ts"))};
import { readClaudeSessionTitle } from ${JSON.stringify(join(root, "src/integrations/harness/providers/claude/claude.ts"))};
const backend = new HostChildBackend();
configureChildBackend(backend);
const releaseBridge = await acquireHarnessBridge();

try {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  const dbFile = join(home, 'state_5.sqlite');
  if (existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const row = db.prepare("SELECT id, cwd FROM threads WHERE name IS NOT NULL AND name<>'' LIMIT 1").get(); db.close();
    if (row) {
      const title = await readCodexSessionTitle({ sessionId: 'title-smoke', providerSessionId: String(row.id), cwd: String(row.cwd) });
      console.log('Codex metadata-only native title read:', !!title);
      if (!title) process.exitCode = 1;
    } else console.log('Codex: no named native sample; not verified');
  } else console.log('Codex: native metadata database unavailable; not verified');
  let found = false;
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  for (const cwd of [${JSON.stringify(root)}, process.env.MONOCODE_TITLE_SMOKE_CWD].filter(Boolean)) {
    const project = join(claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    if (!existsSync(project)) continue;
    for (const name of readdirSync(project).filter((name) => name.endsWith('.jsonl')).slice(0, 20)) {
      const id = name.slice(0, -6);
      const title = await readClaudeSessionTitle({ sessionId: 'title-smoke', providerSessionId: id, cwd });
      if (title) { found = true; break; }
    }
    if (found) break;
  }
  console.log('Claude native transcript title read:', found ? 'verified' : 'no matching titled sample; not verified');
} finally { await backend.close(); releaseBridge(); }
`;
  const file = join(directory, "probe.mjs");
  await build({
    stdin: { contents: source, resolveDir: root, sourcefile: "title-smoke.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: file,
    logLevel: "silent",
  });
  await copyFile(
    join(root, "host/provider-guard.mjs"),
    join(directory, "provider-guard.mjs"),
  );
  // External packages resolve from this repository, not the temporary folder.
  const { symlink } = await import("node:fs/promises");
  await symlink(join(root, "node_modules"), join(directory, "node_modules"));
  const { stdout, stderr } = await run(process.execPath, [file], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  process.stdout.write(stdout);
  if (stderr && !stderr.includes("ExperimentalWarning"))
    process.stderr.write(stderr);
} finally {
  await rm(directory, { recursive: true, force: true });
}
