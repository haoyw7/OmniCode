import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
const runtime = createRequire(import.meta.url)("./workbuddyRuntime.cjs");
const directories: string[] = [];
function temporary() { const directory = mkdtempSync(join(tmpdir(), "omnicode-wb-unit-")); directories.push(directory); return directory; }
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
