// Disposable real HTTP/SQLite Host. No personal data, native CLIs or model calls.
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "monocode-loading-benchmark-"));
const run = promisify(execFile);
const baselineRef = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice(11) ?? "HEAD";
const source = String.raw`
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HostStore } from ${JSON.stringify(join(root, "host/store.ts"))};
import { HostEngine } from ${JSON.stringify(join(root, "host/engine.ts"))};
import { createHostServer } from ${JSON.stringify(join(root, "host/server.ts"))};
import { MobileClient, HostRequestError } from ${JSON.stringify(join(root, "src/mobile/client.ts"))};
import { MobileClient as BeforeClient } from './before.mjs';
const store = new HostStore(${JSON.stringify(join(directory, "host.db"))});
const engine = new HostEngine(store, {});
const project = await engine.openProject(${JSON.stringify(directory)});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64');
mkdirSync(store.attachmentDir, { recursive: true });
const imageId = randomUUID();
writeFileSync(join(store.attachmentDir, imageId), png);
for (const id of ['benchmark-one', 'benchmark-two']) {
  store.save({ projectId: project.id, revision: 1, status: 'idle', updatedAt: Date.now(), session: {
    id, title: id === 'benchmark-one' ? 'Loading benchmark A' : 'Loading benchmark B',
    harness: 'codex', model: 'codex:test', modelSettings: {}, runtimeMode: 'supervised', cwd: project.cwd,
    blocks: Array.from({ length: 1000 }, (_, index) => ({
      id: id + '-' + index, role: index % 2 === 0 ? 'user' : 'assistant',
      text: index % 2 === 0 ? '检查加载速度，第 ' + index + ' 条消息。' : 'The conversation should render immediately.\n\n**Result:** text is ready; images load separately. '.repeat(6),
      ...(index === 998 ? { attachments: [{ id: imageId, name: 'preview.png', kind: 'image', mimeType: 'image/png', size: png.length, path: join(store.attachmentDir, imageId) }] } : {}),
    })),
  }}, { type: 'benchmark' });
}
const server = createHostServer(engine, []);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const endpoint = 'http://127.0.0.1:' + server.address().port;
const device = store.issueDevice('Disposable benchmark', '123');
const storage = () => {
  const values = new Map();
  return { get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); } };
};
let imageDelay = 0;
const rpc = async (url, token, request) => {
  if (request.method === 'attachments.read' && imageDelay) await delay(imageDelay);
  const response = await fetch(url + '/rpc', { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const envelope = await response.json();
  if (!response.ok) throw new HostRequestError(envelope.error, response.status);
  return envelope.result;
};
const summarize = (values) => {
  values.sort((a, b) => a - b);
  return { samples: values.length, medianMs: +values[Math.floor(values.length / 2)].toFixed(6),
    p95Ms: +values[Math.min(values.length - 1, Math.ceil(values.length * .95) - 1)].toFixed(6) };
};
let preview;
try {
  const cold = [];
  let latest;
  for (let index = 0; index < 20; index++) {
    latest = new MobileClient(storage(), rpc);
    await latest.connect(endpoint, device.token);
    const start = performance.now();
    await latest.session('benchmark-one');
    cold.push(performance.now() - start);
  }
  const cached = [];
  for (let index = 0; index < 1000; index++) {
    const start = performance.now();
    if (!latest.cachedSession('benchmark-one')) throw new Error('Missing cache');
    cached.push(performance.now() - start);
  }
  imageDelay = 500;
  const before = new BeforeClient(storage(), rpc);
  await before.connect(endpoint, device.token);
  let start = performance.now();
  await before.session('benchmark-two');
  const beforeMs = performance.now() - start;
  const after = new MobileClient(storage(), rpc);
  await after.connect(endpoint, device.token);
  start = performance.now();
  await after.session('benchmark-two');
  const afterMs = performance.now() - start;
  const results = { node: process.version, baseline: process.env.MONOCODE_LOADING_BASELINE, blocks: 1000,
    snapshotBytes: Buffer.byteLength(JSON.stringify(store.sync('benchmark-one'))),
    localColdTextSync: summarize(cold), memoryCacheLookup: summarize(cached),
    simulatedSlowImage: { imageDelayMs: 500, beforeTextReadyMs: +beforeMs.toFixed(3), afterTextReadyMs: +afterMs.toFixed(3) } };
  console.log(JSON.stringify(results, null, 2));
  if (process.argv.includes('--serve')) {
    // Freeze a minified production React build with a fixture-only browser
    // transport. Native production transport and Host origin checks stay intact.
    const assets = ${JSON.stringify(join(directory, "mobile"))};
    preview = createServer(async (request, response) => {
      try {
        if (request.url === '/__mobile/rpc' && request.method === 'POST') {
          let body = '';
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 1024 * 1024) throw new Error('Request too large');
          }
          const input = JSON.parse(body);
          if (input.endpoint !== endpoint) throw new Error('Different benchmark Host');
          const result = await fetch(endpoint + '/rpc', { method: 'POST',
            headers: { Authorization: request.headers.authorization ?? '', 'Content-Type': 'application/json' },
            body: JSON.stringify(input.request), signal: AbortSignal.timeout(20_000) });
          response.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(await result.text());
          return;
        }
        const path = decodeURIComponent(new URL(request.url, endpoint).pathname);
        const file = resolve(assets, '.' + (path === '/' ? '/index.html' : path));
        if (!file.startsWith(assets + sep)) throw new Error('Invalid path');
        const contentTypes = { js: 'text/javascript', css: 'text/css', html: 'text/html', json: 'application/json', wasm: 'application/wasm', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', woff2: 'font/woff2' };
        const data = readFileSync(file);
        response.writeHead(200, { 'Content-Type': contentTypes[file.split('.').at(-1)] ?? 'application/octet-stream' });
        response.end(data);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((done) => preview.listen(0, '127.0.0.1', done));
    console.log('DISPOSABLE_BROWSER_HOST=' + endpoint);
    console.log('DISPOSABLE_BROWSER_TOKEN=' + device.token);
    console.log('DISPOSABLE_BROWSER_URL=http://127.0.0.1:' + preview.address().port);
    await new Promise((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
  }
} finally {
  if (preview) {
    preview.closeAllConnections();
    await new Promise((done) => preview.close(done));
  }
  await engine.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  store.close();
}
`;
try {
  const { stdout: resolvedBaseline } = await run("git", ["rev-parse", "--verify", baselineRef + "^{commit}"], { cwd: root });
  const baseline = resolvedBaseline.trim();
  const { stdout: before } = await run("git", ["show", baseline + ":src/mobile/client.ts"], { cwd: root });
  await symlink(join(root, "node_modules"), join(directory, "node_modules"));
  await build({ stdin: { contents: before, resolveDir: join(root, "src/mobile"), sourcefile: "client-before.ts", loader: "ts" },
    bundle: true, platform: "node", format: "esm", packages: "external", outfile: join(directory, "before.mjs"), logLevel: "silent" });
  const entry = join(directory, "benchmark.mjs");
  await build({ stdin: { contents: source, resolveDir: directory, sourcefile: "mobile-loading-benchmark.ts", loader: "ts" },
    bundle: true, platform: "node", format: "esm", packages: "external", loader: { ".ps1": "text" },
    define: { "import.meta.hot": "undefined" }, outfile: entry, logLevel: "silent" });
  if (process.argv.includes("--serve")) {
    const { build: buildWeb, loadConfigFromFile } = await import("vite");
    const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, join(root, "vite.mobile.config.ts"));
    if (!loaded) throw new Error("Missing mobile build configuration");
    const assets = join(directory, "mobile");
    await buildWeb({ ...loaded.config, configFile: false, root, logLevel: "error",
      plugins: loaded.config.plugins.filter((plugin) => plugin?.name !== "mobile-entry"),
      define: { ...loaded.config.define, "import.meta.env.DEV": "true" },
      build: { ...loaded.config.build, outDir: assets, emptyOutDir: true,
        rollupOptions: { ...loaded.config.build.rollupOptions, input: join(root, "mobile.html") } },
    });
    await rename(join(assets, "mobile.html"), join(assets, "index.html"));
  }
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: "inherit", detached: true, env: { ...process.env, MONOCODE_LOADING_BASELINE: baseline },
  });
  const forward = () => child.kill("SIGINT");
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const code = await new Promise((done) => child.once("exit", done));
  process.removeListener("SIGINT", forward);
  process.removeListener("SIGTERM", forward);
  process.exitCode = code ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
