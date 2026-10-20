/* Runs on the execution machine. Credentials never cross the stdio boundary. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const EDITIONS = [
  { edition: 'cn', directory: 'WorkBuddy', executable: 'WorkBuddy.exe', bundle: 'WorkBuddy.app', origin: 'https://www.workbuddy.cn', authId: 'workbuddy-desktop', label: 'WorkBuddy China' },
  { edition: 'global', directory: 'WorkBuddyAI', executable: 'WorkBuddyAI.exe', bundle: 'WorkBuddy AI.app', origin: 'https://www.workbuddy.ai', authId: 'workbuddy-desktop-ai', label: 'WorkBuddy International' },
];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
class BridgeError extends Error {}
function fail(message) { throw new BridgeError(message); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function discoveryLocations(platform = process.platform, home = os.homedir(), local = process.env.LOCALAPPDATA) {
  if (platform === 'win32') {
    const data = local || path.join(home, 'AppData', 'Local');
    return { platform, data, candidates: EDITIONS.map(e => path.join(data, 'Programs', e.directory, e.executable)) };
  }
  if (platform === 'darwin') return { platform, data: path.join(home, 'Library', 'Application Support'),
    candidates: [path.join(home, 'Applications'), '/Applications'].flatMap(dir => EDITIONS.map(e => path.join(dir, e.bundle))) };
  return { platform, data: '', candidates: [] };
}
function installationLayout(candidate, platform) {
  let executable = path.resolve(candidate);
  if (platform === 'darwin' && executable.endsWith('.app')) {
    const directory = path.join(executable, 'Contents', 'MacOS');
    const binaries = fs.readdirSync(directory).filter(name => !name.startsWith('.') && fs.statSync(path.join(directory, name)).isFile());
    if (binaries.length !== 1) fail('Configured path is not a WorkBuddy installation');
    executable = path.join(directory, binaries[0]);
  }
  const resources = platform === 'darwin' ? path.join(path.dirname(path.dirname(executable)), 'Resources') : path.join(path.dirname(executable), 'resources');
  return { executable, resources, cli: path.join(resources, 'app.asar.unpacked', 'cli') };
}
function installations(options = {}, locations = discoveryLocations()) {
  if (!['win32', 'darwin'].includes(locations.platform)) return [];
  const candidates = [...locations.candidates];
  if (options.binaryPath) candidates.unshift(options.binaryPath);
  const found = new Map();
  let overrideValid = !options.binaryPath;
  for (const candidate of candidates) {
    try {
      const { executable, resources, cli } = installationLayout(candidate, locations.platform);
      const product = json(path.join(cli, 'product.json'));
      const edition = EDITIONS.find(e => e.authId === product.authentication?.id && e.origin === product.endpoint);
      if (!edition || found.has(edition.edition) || !fs.statSync(executable).isFile()) continue;
      if (!fs.statSync(path.join(cli, 'bin', 'codebuddy')).isFile()) continue;
      if (candidate === options.binaryPath) overrideValid = true;
      const pkg = json(path.join(cli, 'package.json'));
      found.set(edition.edition, { ...edition, executable, resources, cli, product,
        appVersion: product.version || product.genieVersion || '',
        cliVersion: pkg.publishConfig?.customPackage?.version || '',
        authFile: path.join(locations.data, 'CodeBuddyExtension', 'Data', 'Public', 'auth', edition.authId + '.info') });
    } catch { /* An absent or partly updated installation is unavailable. */ }
  }
  if (!overrideValid) fail('Configured path is not a WorkBuddy installation');
  return [...found.values()];
}
function accountFor(installation) {
  try {
    const doc = json(installation.authFile);
    if (!doc.account?.uid || !doc.auth?.accessToken) return null;
    const id = 'wb-' + installation.edition + '-' + hash(String(doc.account.uid)).slice(0, 32);
    return { id, label: installation.label, edition: installation.edition, readOnly: true,
      identity: { ...(typeof doc.account.email === 'string' ? { email: doc.account.email } : {}),
        ...(typeof (doc.account.name || doc.account.nickname) === 'string' ? { name: doc.account.name || doc.account.nickname } : {}) } };
  } catch { return null; }
}
function accounts(options = {}) { return installations(options).flatMap(i => { const a = accountFor(i); return a ? [a] : []; }); }
function select(options) {
  const available = installations(options);
  const installation = options.accountId && options.accountId !== 'default'
    ? available.find(i => accountFor(i)?.id === options.accountId)
    : available.find(i => accountFor(i));
  if (!installation) fail('The selected WorkBuddy login is no longer available. Sign in on the execution machine and refresh accounts.');
  return installation;
}
function readAsarEntry(archive, name) {
  const noAsar = process.noAsar;
  process.noAsar = true;
  let fd;
  try {
    fd = fs.openSync(archive, 'r');
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (headerSize > 32 * 1024 * 1024 || jsonSize > headerSize - 8) fail('Unsupported WorkBuddy archive');
    const header = Buffer.alloc(jsonSize); fs.readSync(fd, header, 0, jsonSize, 16);
    let entry = JSON.parse(header.toString('utf8'));
    for (const part of name.split('/')) entry = entry.files?.[part];
    if (!entry || entry.unpacked || !Number.isSafeInteger(entry.size) || entry.size > 16 * 1024 * 1024) fail('Unsupported WorkBuddy authentication module');
    const bytes = Buffer.alloc(entry.size);
    const position = 8 + headerSize + Number(entry.offset);
    if (!Number.isSafeInteger(position) || position < 8 + headerSize) fail('Invalid WorkBuddy archive entry');
    if (fs.readSync(fd, bytes, 0, bytes.length, position) !== bytes.length) fail('Incomplete WorkBuddy archive entry');
    return bytes;
  } finally { if (fd !== undefined) fs.closeSync(fd); process.noAsar = noAsar; }
}
function accessToken(installation, configRoot, expectedAccountId) {
  const archive = path.join(installation.resources, 'app.asar');
  const modules = ['app-lifetime-job.js', 'rolldown-runtime.js', 'logger2.js'].map(name => ({ name, bytes: readAsarEntry(archive, 'main/' + name) }));
  const cryptoDir = path.join(configRoot, 'bridge-code', hash(Buffer.concat(modules.map(m => m.bytes))));
  fs.mkdirSync(cryptoDir, { recursive: true, mode: 0o700 });
  for (const module of modules) {
    const destination = path.join(cryptoDir, module.name);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, module.bytes, { mode: 0o600, flag: 'wx' });
  }
  const c = require(path.join(cryptoDir, 'app-lifetime-job.js'));
  if (typeof c.D !== 'function') fail('This WorkBuddy authentication version is not supported');
  c.D();
  if (![c.G, c.R, c.K].every(f => typeof f === 'function')) fail('This WorkBuddy authentication version is not supported');
  const caps = c.G(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet());
  if (caps.symmetric.status !== 'available') fail('WorkBuddy authentication storage is unavailable');
  const codec = new c.R(caps.symmetric.value);
  let plain;
  try {
    const doc = json(installation.authFile);
    if ('wb-' + installation.edition + '-' + hash(String(doc.account?.uid)).slice(0, 32) !== expectedAccountId) fail('This WorkBuddy conversation belongs to another account');
    if (doc.auth?.accessToken?.$wbEncrypted !== 1) fail('Unsupported WorkBuddy login record');
    plain = codec.open(c.K(Buffer.from(doc.auth.accessToken.envelope, 'base64')), { framing: 'field' });
    const value = plain.toString('utf8');
    const token = value.startsWith('"') ? JSON.parse(value) : value;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (new URL(claims.iss).origin !== installation.origin || String(claims.sub) !== String(doc.account.uid)) fail('WorkBuddy login does not match the selected region and account');
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) fail('WorkBuddy login has expired. Sign in on the execution machine and refresh accounts.');
    return token;
  } finally { plain?.fill(0); codec.dispose(); caps.symmetric.value.key.fill(0); }
}
function environment(installation, token, configDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CODEBUDDY_|ACC_PRODUCT_CONFIG|ENV_PRODUCT_CLI_|AUTH_TOKEN$|WORKBUDDY_CONFIG_DIR$)/.test(key)) delete env[key];
  return Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_AUTH_TOKEN: token,
    CODEBUDDY_CREDENTIALS_IN_MEMORY: '1', CODEBUDDY_CONFIG_DIR: configDir, WORKBUDDY_CONFIG_DIR: configDir,
    CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1', ACC_PRODUCT_CONFIG_PATH: path.join(installation.cli, 'product.json'),
    DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CODEBUDDY_DISABLE_COMPILE_CACHE: '1',
    CODEBUDDY_DISABLE_IDE: '1', CODEBUDDY_DISABLE_CRON: '1', CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1', CODEBUDDY_DISABLE_AUTO_MEMORY: '1' });
}
function imageMime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return 'image/webp';
  fail('Unsupported generated image type');
}
function imageResults(message, calls) {
  for (const part of message.message?.content || []) if (part.type === 'tool_use') calls.set(part.id,
    part.name === 'DeferExecuteTool' ? part.input?.tool_name || part.input?.toolName || part.input?.name : part.name);
  const output = [];
  for (const part of message.message?.content || []) {
    if (part.type !== 'tool_result' || !['ImageGen', 'ImageEdit'].includes(calls.get(part.tool_use_id)) || part.is_error) continue;
    const values = typeof part.content === 'string' ? [part.content] : (part.content || []).filter(c => c.type === 'text').map(c => c.text);
    for (const value of values) {
      let result; try { result = JSON.parse(value); } catch { continue; }
      if (result.type !== 'image_gen_tool_result' || result.status !== 'completed' || !Array.isArray(result.images)) continue;
      for (const [index, image] of result.images.entries()) {
        try {
          if (typeof image.localPath !== 'string' || !path.isAbsolute(image.localPath)) continue;
          const stat = fs.statSync(image.localPath);
          if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) fail('Generated image exceeds 20 MiB');
          const bytes = fs.readFileSync(image.localPath);
          output.push({ itemId: part.tool_use_id + ':' + index, name: path.basename(image.localPath), mimeType: imageMime(bytes), data: bytes.toString('base64') });
        } catch { output.push({ itemId: part.tool_use_id + ':' + index, error: 'Could not read the generated image on the execution machine' }); }
      }
    }
  }
  return output;
}
function sanitize(message, token) {
  const account = message.type === 'control_response' ? message.response?.response?.account : undefined;
  if (account && typeof account === 'object') {
    for (const key of ['token', 'accessToken', 'refreshToken']) delete account[key];
  }
  return JSON.stringify(message).split(token).join('[redacted]');
}
function lines(stream, consume) {
  const decoder = new StringDecoder('utf8'); let buffer = '';
  const push = text => {
    buffer += text;
    if (buffer.length > 32 * 1024 * 1024) fail('WorkBuddy output exceeded the message limit');
    let n; while ((n = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, n); buffer = buffer.slice(n + 1); if (line.trim()) consume(line); }
  };
  stream.on('data', bytes => push(decoder.write(bytes)));
  stream.on('end', () => { push(decoder.end()); if (buffer.trim()) consume(buffer); buffer = ''; });
}
function engine(options, args) {
  const installation = select(options);
  const account = accountFor(installation);
  if (options.accountId && options.accountId !== 'default' && options.accountId !== account?.id) fail('This WorkBuddy conversation belongs to another account');
  const root = options.configRoot || path.join(discoveryLocations().data, 'OmniCode', 'workbuddy');
  const config = path.join(root, account.id);
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  const token = accessToken(installation, root, account.id);
  const child = spawn(installation.executable, [path.join(installation.cli, 'bin', 'codebuddy'), ...args], {
    env: environment(installation, token, config), cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { child, token, installation, account };
}
async function catalogOne(options) {
  const { child, installation } = engine(options, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('WorkBuddy initialization timed out')); }, 25000);
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); error ? reject(error) : resolve(value); };
    child.on('error', () => finish(new Error('Could not start WorkBuddy')));
    child.on('exit', () => finish(new Error('WorkBuddy exited before initialization')));
    child.stderr.resume();
    lines(child.stdout, line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.type !== 'control_response' || msg.response?.request_id !== 'omnicode-catalog') return;
      if (msg.response.subtype !== 'success') return finish(new Error('WorkBuddy initialization failed'));
      const data = msg.response.response;
      const models = (data?.models || []).flatMap(m => {
        const id = m.id || m.modelId || m.value;
        if (typeof id !== 'string' || !id) return [];
        const definition = installation.product.models?.find(d => d.id === id);
        return [{ id: 'workbuddy:' + installation.edition + ':' + id, nativeId: id, name: m.name || m.label || id,
          provider: { id: installation.edition, name: installation.label }, supportsImages: m.supportsImages ?? definition?.supportsImages ?? true,
          ...(Number.isFinite(m.maxInputTokens) ? { contextWindow: m.maxInputTokens } : {}) }];
      });
      finish(null, { account: accountFor(installation), models, cliVersion: installation.cliVersion });
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'omnicode-catalog', request: { subtype: 'initialize' } }) + '\n');
  });
}
function run(options, args) {
  const { child, token } = engine(options, args);
  const calls = new Map();
  child.stdin.on('error', () => {});
  process.stdin.pipe(child.stdin);
  // SDK initialization includes a token. Redact before emitting any line.
  lines(child.stdout, line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const images = imageResults(msg, calls);
    process.stdout.write(sanitize(msg, token) + '\n');
    for (const image of images) process.stdout.write(sanitize({ type: 'omnicode_image', session_id: msg.session_id,
      __timestamp: msg.__timestamp, omnicode_generated_images: [image] }, token) + '\n');
  });
  lines(child.stderr, () => { /* Provider diagnostics can contain auth/configuration. */ });
  child.on('error', () => { process.stdout.write(JSON.stringify({ type: 'omnicode_error', message: 'Could not start WorkBuddy' }) + '\n'); process.exit(1); });
  child.on('exit', code => { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); process.exit(code ?? 1); });
  const stop = () => { if (child.pid) child.kill(); setTimeout(() => process.exit(0), 500).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.on('end', stop);
}
async function main() {
  const [mode, encoded = '{}', ...args] = process.argv.slice(2);
  const options = JSON.parse(encoded);
  if (mode === 'accounts') return accounts(options);
  if (mode === 'resolve') {
    const installed = options.accountId ? select(options) : installations(options)[0];
    if (!installed) fail('WorkBuddy is not installed');
    return { path: installed.executable, cliVersion: installed.cliVersion };
  }
  if (mode === 'catalog-one') return await catalogOne(options);
  if (mode === 'catalog') {
    const output = { accounts: accounts(options), models: [], errors: [] };
    for (const installation of installations(options)) {
      const account = accountFor(installation); if (!account) continue;
      const r = spawnSync(installation.executable, [__filename, 'catalog-one', JSON.stringify({ ...options, accountId: account.id })], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      });
      try { const row = JSON.parse(r.stdout); if (!r.status && Array.isArray(row.models)) output.models.push(...row.models); else output.errors.push({ edition: installation.edition, message: row.error || 'WorkBuddy initialization failed' }); }
      catch { output.errors.push({ edition: installation.edition, message: 'WorkBuddy initialization failed' }); }
    }
    return output;
  }
  if (mode === 'run') { run(options, args); return undefined; }
  fail('Unsupported WorkBuddy bridge operation');
}
module.exports = { accounts, accountFor, installations, discoveryLocations, select, readAsarEntry, imageMime, imageResults, sanitize, environment };
if (require.main === module) main().then(value => { if (value !== undefined) { process.stdout.write(JSON.stringify(value) + '\n'); process.exit(0); } }).catch(error => {
  // Do not serialize native exceptions: malformed JWT/envelope errors may quote secrets.
  process.stdout.write(JSON.stringify({ error: error instanceof BridgeError ? error.message : 'WorkBuddy authentication or initialization failed. Refresh the login on the execution machine.' }) + '\n');
  process.exit(1);
});
