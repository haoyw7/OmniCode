import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
const runtime = createRequire(import.meta.url)("./workbuddyRuntime.cjs");
const directories: string[] = [];
function temporary() { const directory = mkdtempSync(join(tmpdir(), "omnicode-wb-unit-")); directories.push(directory); return directory; }
function asar(archive: string, modules: Record<string, string>) {
  let offset = 0;
  const files = Object.fromEntries(Object.entries(modules).map(([name, code]) => {
    const size = Buffer.byteLength(code), position = offset; offset += size;
    return [name, { size, offset: String(position) }];
  }));
  const header = Buffer.from(JSON.stringify({ files: { main: { files } } }));
  const prefix = Buffer.alloc(16); prefix.writeUInt32LE(header.length + 8, 4); prefix.writeUInt32LE(header.length, 12);
  writeFileSync(archive, Buffer.concat([prefix, header, ...Object.values(modules).map(code => Buffer.from(code))]));
}
afterEach(() => {
  for (const dir of directories.splice(0)) {
    const resolved = realpathSync(dir);
    if (!resolved.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup");
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each(["win32", "darwin"])("WorkBuddy %s installation discovery", platform => {
  function fixture() {
    const home = temporary();
    const locations = runtime.discoveryLocations(platform, home, home);
    // Keep discovery inside the fixture, including on a machine with real apps.
    locations.candidates = locations.candidates.filter((file: string) => file.startsWith(home + sep));
    for (const [index, candidate] of locations.candidates.entries()) {
      const executable = platform === "darwin" ? join(candidate, "Contents/MacOS/WorkBuddy") : candidate;
      const resources = platform === "darwin" ? join(candidate, "Contents/Resources") : join(dirname(executable), "resources");
      const cli = join(resources, "app.asar.unpacked/cli");
      mkdirSync(dirname(executable), { recursive: true });
      mkdirSync(join(cli, "bin"), { recursive: true });
      writeFileSync(executable, ""); writeFileSync(join(cli, "bin/codebuddy"), "");
      const authId = index === 0 ? "workbuddy-desktop" : "workbuddy-desktop-ai";
      writeFileSync(join(cli, "product.json"), JSON.stringify({ endpoint: index === 0 ? "https://www.workbuddy.cn" : "https://www.workbuddy.ai", authentication: { id: authId } }));
      writeFileSync(join(cli, "package.json"), JSON.stringify({ publishConfig: { customPackage: { version: "2.fixture" } } }));
      const auth = join(locations.data, "CodeBuddyExtension/Data/Public/auth"); mkdirSync(auth, { recursive: true });
      writeFileSync(join(auth, authId + ".info"), JSON.stringify({ account: { uid: "fixture" }, auth: { accessToken: "secret-fixture" } }));
    }
    return { home, locations };
  }
  it("finds both regions and platform data directories without exposing credentials", () => {
    const { home, locations } = fixture();
    const installs = runtime.installations({}, locations);
    expect(installs.map((i: { edition: string }) => i.edition)).toEqual(["cn", "global"]);
    expect(installs[0].authFile).toBe(join(home, ...(platform === "darwin" ? ["Library", "Application Support"] : []), "CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"));
    const accounts = installs.map(runtime.accountFor);
    expect(accounts.every((a: { readOnly: boolean }) => a.readOnly)).toBe(true);
    expect(JSON.stringify(accounts)).not.toContain("secret-fixture");
    expect(JSON.stringify(accounts)).not.toContain(home);
  });
  it("accepts a configured bundle or executable and prioritizes its edition", () => {
    const { locations } = fixture();
    const candidate = locations.candidates[1];
    const installs = runtime.installations({ binaryPath: candidate }, locations);
    expect(installs[0].edition).toBe("global");
    expect(runtime.installations({ binaryPath: installs[0].executable }, locations)[0].executable).toBe(installs[0].executable);
    expect(installs[0].cliVersion).toBe("2.fixture");
  });
  it("recognizes the Tencent China endpoint and keeps issuer aliases within their region", () => {
    const { locations } = fixture();
    const cn = runtime.installations({}, locations)[0];
    writeFileSync(join(cn.cli, "product.json"), JSON.stringify({ endpoint: "https://copilot.tencent.com", authentication: { id: "workbuddy-desktop" }, genieVersion: "5.4.5" }));
    const installs = runtime.installations({ binaryPath: locations.candidates[0] }, locations);
    expect(installs.map((i: { edition: string }) => i.edition)).toEqual(["cn", "global"]);
    expect(installs[0].appVersion).toBe("5.4.5");
    expect(runtime.acceptsOrigin(installs[0], "https://copilot.tencent.com")).toBe(true);
    expect(runtime.acceptsOrigin(installs[0], "https://www.workbuddy.cn")).toBe(true);
    expect(runtime.acceptsOrigin(installs[0], "https://www.workbuddy.ai")).toBe(false);
    expect(runtime.acceptsOrigin(installs[1], "https://copilot.tencent.com")).toBe(false);
    expect(runtime.acceptsOrigin(installs[0], "https://copilot.tencent.com.example.test")).toBe(false);
    writeFileSync(join(cn.cli, "product.json"), JSON.stringify({ endpoint: "https://copilot.tencent.com", authentication: { id: "workbuddy-desktop-ai" } }));
    expect(() => runtime.installations({ binaryPath: locations.candidates[0] }, locations)).toThrow("Configured path");
  });
  it("rejects a mismatched regional product and an invalid override", () => {
    const { home, locations } = fixture();
    const installed = runtime.installations({}, locations)[0];
    writeFileSync(join(installed.cli, "product.json"), JSON.stringify({ endpoint: "https://www.workbuddy.ai", authentication: { id: "workbuddy-desktop" } }));
    expect(runtime.installations({}, locations).map((i: { edition: string }) => i.edition)).toEqual(["global"]);
    expect(() => runtime.installations({ binaryPath: locations.candidates[0] }, locations)).toThrow("Configured path");
    expect(() => runtime.installations({ binaryPath: join(home, "missing") }, locations)).toThrow("Configured path");
  });
});
describe("execution-side WorkBuddy credential boundary", () => {
  it("accepts existing plaintext logins without loading crypto while validating region, account and expiry", () => {
    const root = temporary(), authFile = join(root, "auth.info");
    const installation = { edition: "cn", authFile, origins: ["https://www.workbuddy.cn", "https://copilot.tencent.com"] };
    const expires = Math.floor(Date.now() / 1000) + 300;
    const record = (iss: string, sub = "fixture", exp = expires) => {
      const token = `fixture.${Buffer.from(JSON.stringify({ iss, sub, exp })).toString("base64url")}.fixture`;
      writeFileSync(authFile, JSON.stringify({ account: { uid: "fixture" }, auth: { accessToken: token } }));
      return token;
    };
    for (const origin of installation.origins) {
      const token = record(origin + "/auth/realms/copilot");
      const account = runtime.accountFor(installation);
      expect(runtime.accessToken(installation, root, account.id)).toBe(token);
      expect(runtime.accountFor(installation).id).toBe(account.id);
      expect(() => runtime.accessToken(installation, root, "wb-cn-another-account")).toThrow("another account");
    }
    const account = runtime.accountFor(installation);
    record("https://www.workbuddy.ai");
    expect(() => runtime.accessToken(installation, root, account.id)).toThrow("region and account");
    record("https://www.workbuddy.cn", "another-user");
    expect(() => runtime.accessToken(installation, root, account.id)).toThrow("region and account");
    record("https://www.workbuddy.cn", "fixture", 1);
    expect(() => runtime.accessToken(installation, root, account.id)).toThrow("expired");
  });
  it.each(["legacy", "lazy", "named"])("loads the %s crypto layout and clears key material on disposal and initialization failure", format => {
    const root = temporary();
    const code = `class Crypto {
      constructor(current) { if (current.fail) throw new Error('fixture failure'); this.key = Buffer.from(current.key); }
      open(value) { if (this.disposed) throw new Error('disposed'); return Buffer.from(value.text); }
      dispose() { this.key.fill(0); this.disposed = true; }
    }
    const parse = bytes => JSON.parse(bytes.toString());
    let initialized = false;
    module.exports = ${format === "named"
      ? "{ AtRestCrypto: Crypto, parseSupportedEnvelope: parse, normalizeAtRestKeyPayload: value => value }"
      : format === "lazy"
      ? "{ D() { initialized = true; }, get R() { return initialized ? Crypto : undefined; }, K: parse, G: value => ({ symmetric: { status: 'available', value } }) }"
      : "{ D() {}, R: Crypto, K: parse, G: value => ({ symmetric: { status: 'available', value } }) }"};`;
    asar(join(root, "app.asar"), format === "named"
      ? { "dist.js": code, "chunk.js": "" }
      : { "app-lifetime-job.js": code, "rolldown-runtime.js": "", "logger2.js": "" });
    const key = Buffer.alloc(32, 7);
    const codec = runtime.authenticationCodec({ resources: root }, root, () => ({ key, keyId: "fixture" }));
    const envelope = Buffer.from(JSON.stringify({ text: "fixture-only" }));
    expect(codec.open(envelope).toString()).toBe("fixture-only");
    codec.dispose();
    expect(key.every(byte => byte === 0)).toBe(true);
    expect(() => codec.open(envelope)).toThrow("disposed");
    const failedKey = Buffer.alloc(32, 8);
    expect(() => runtime.authenticationCodec({ resources: root }, root, () => ({ key: failedKey, keyId: "fixture", fail: true }))).toThrow("fixture failure");
    expect(failedKey.every(byte => byte === 0)).toBe(true);
  });
  it("removes initialization credentials and exact secret occurrences while preserving user tool fields", () => {
    const record = { type: "control_response", response: { response: { account: { uid: "user", token: "test-secret", accessToken: "test-secret", refreshToken: "refresh" } } }, input: { token: "user-owned-value", account: { token: "user-owned-value" }, text: "test-secret" } };
    const serialized = runtime.sanitize(record, "test-secret");
    expect(serialized).not.toContain("test-secret");
    expect(JSON.parse(serialized).response.response.account).toEqual({ uid: "user" });
    expect(JSON.parse(serialized).input.token).toBe("user-owned-value");
    expect(JSON.parse(serialized).input.account.token).toBe("user-owned-value");
  });
  it("isolates inherited credentials, product and config directories", () => {
    const env = runtime.environment({ cli: "/workbuddy/cli" }, "in-memory", "/isolated");
    expect(env.CODEBUDDY_CREDENTIALS_IN_MEMORY).toBe("1");
    expect(env.CODEBUDDY_AUTH_TOKEN).toBe("in-memory");
    expect(env.CODEBUDDY_CONFIG_DIR).toBe("/isolated");
    expect(env.WORKBUDDY_CONFIG_DIR).toBe("/isolated");
    expect(env.ACC_PRODUCT_CONFIG_PATH).toBe(join("/workbuddy/cli", "product.json"));
  });
  it("reads bounded packed ASAR code and rejects truncated or missing entries", () => {
    const code = Buffer.from("module.exports = {};");
    const header = Buffer.from(JSON.stringify({ files: { main: { files: { "code.js": { size: code.length, offset: "0" } } } } }));
    const prefix = Buffer.alloc(16); prefix.writeUInt32LE(header.length + 8, 4); prefix.writeUInt32LE(header.length, 12);
    const archive = join(temporary(), "app.asar");
    writeFileSync(archive, Buffer.concat([prefix, header, code]));
    expect(runtime.readAsarEntry(archive, "main/code.js")).toEqual(code);
    expect(() => runtime.readAsarEntry(archive, "main/missing.js")).toThrow();
    writeFileSync(archive, Buffer.concat([prefix, header]));
    expect(() => runtime.readAsarEntry(archive, "main/code.js")).toThrow();
  });
  it("materializes only successful image-tool results, including deferred ImageGen", () => {
    const image = join(temporary(), "test.png");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    writeFileSync(image, Buffer.from(png, "base64"));
    const calls = new Map();
    runtime.imageResults({ message: { content: [{ type: "tool_use", id: "image-1", name: "DeferExecuteTool", input: { toolName: "ImageGen", params: {} } }] } }, calls);
    const response = { message: { content: [{ type: "tool_result", tool_use_id: "image-1", content: [{ type: "text", text: JSON.stringify({ type: "image_gen_tool_result", status: "completed", images: [{ localPath: image }] }) }] }] } };
    expect(runtime.imageResults(response, calls)).toEqual([{ itemId: "image-1:0", name: "test.png", mimeType: "image/png", data: png }]);
    expect(runtime.imageResults(response, new Map())).toEqual([]);
    expect(runtime.imageResults({ ...response, message: { content: [{ ...response.message.content[0], is_error: true }] } }, calls)).toEqual([]);
  });
});
