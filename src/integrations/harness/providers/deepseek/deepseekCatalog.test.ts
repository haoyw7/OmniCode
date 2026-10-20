import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  line: undefined as ((line: string) => void) | undefined,
  sent: [] as { id: number; method: string; params: unknown }[],
  failed: false,
  home: vi.fn(async () => "/home/fixture"),
  prepare: vi.fn(async () => ({ path: "/fake/dsh", args: [] })),
  spawn: vi.fn(async () => {}),
  kill: vi.fn(async () => {}),
  unwatch: vi.fn(),
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  homeDir: transport.home, saveGeneratedImage: vi.fn(), deleteGeneratedImages: vi.fn(),
}));
vi.mock("../../core/registry", () => ({ publishHarnessCatalog: vi.fn() }));
vi.mock("../../core/child", () => ({
  selectedChildMachine: () => "local",
  prepareDeepseekBridge: transport.prepare,
  spawnChild: transport.spawn,
  killChild: transport.kill,
  unwatchChild: transport.unwatch,
  watchChild: (_id: string, line: (line: string) => void) => { transport.line = line; },
  writeChild: async (_id: string, line: string) => {
    const frame = JSON.parse(line);
    transport.sent.push(frame);
    transport.line!(JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...(transport.failed && frame.method === "account/read"
      ? { error: { code: -32603, message: "Account read failed" } }
      : { result: frame.method === "initialize" ? { protocolVersion: 1, runtimeVersion: "0.2.1-rc.2", capabilities: { multiplex: true } }
        : frame.method === "account/read" ? { status: "signed-out", token: "never-publish" } : {} }) }));
  },
}));
import { discoverDeepseekAccount } from "./deepseekCatalog";

beforeEach(() => { transport.sent = []; transport.failed = false; vi.clearAllMocks(); });
const client = { version: "0.1.0", locale: "zh-CN", timezoneOffsetSeconds: -25_200 };

it("queries the configured DSH account without catalog discovery and shuts down the helper process", async () => {
  expect(await discoverDeepseekAccount(client)).toEqual({ status: "signed-out" });
  expect(transport.sent.map(frame => frame.method)).toEqual(["initialize", "account/read", "shutdown"]);
  expect(transport.sent[0].params).toMatchObject({ includeCatalog: false });
  expect(transport.sent[1].params).toEqual({ client });
  expect(transport.home).toHaveBeenCalledTimes(1);
  expect(transport.prepare).toHaveBeenCalledWith("/home/fixture", undefined);
  expect(transport.kill).toHaveBeenCalledTimes(1);
  expect(transport.unwatch).toHaveBeenCalledTimes(1);
});

it("uses the Host working directory without calling the desktop home-directory API", async () => {
  const cwd = "/host/home with spaces";
  expect(await discoverDeepseekAccount(client, cwd)).toEqual({ status: "signed-out" });
  expect(transport.home).not.toHaveBeenCalled();
  expect(transport.prepare).toHaveBeenCalledWith(cwd, undefined);
  expect(transport.spawn).toHaveBeenCalledWith(expect.any(String), "/fake/dsh", [], cwd, undefined, "deepseek",
    { environmentSessionId: undefined, deepseekHome: undefined });
  expect(transport.sent[0].params).toMatchObject({ includeCatalog: false });
});

it("cleans up the account helper process when DSH rejects the account query", async () => {
  transport.failed = true;
  await expect(discoverDeepseekAccount(client)).rejects.toThrow("Account read failed");
  expect(transport.sent.at(-1)?.method).toBe("shutdown");
  expect(transport.kill).toHaveBeenCalledTimes(1);
  expect(transport.unwatch).toHaveBeenCalledTimes(1);
});
