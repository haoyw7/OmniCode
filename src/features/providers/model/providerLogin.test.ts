vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.descriptor }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(async () => {}), request: vi.fn(), descriptor: vi.fn(), machine: vi.fn(() => "local"), environment: vi.fn(() => "host-local") }));
vi.mock("./providerAccountCredentials", () => ({ loginProviderAccount: mocks.accounts }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../connections/model/remoteProjects", () => ({ sharedHostMachineId: mocks.machine, sharedHostEnvironment: mocks.environment }));
import { loginHarness } from "./providerLogin";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.machine.mockReturnValue("local");
  mocks.descriptor.mockResolvedValue({ capabilities: ["providers.login.v1"] });
  mocks.request.mockResolvedValue({ id: "login", status: "succeeded" });
});

describe("Host sign-in client", () => {
  it.each(["claude", "codex"] as const)("uses the Host account service for %s", async provider => {
    await loginHarness(provider, "work");
    expect(mocks.accounts).toHaveBeenCalledWith(provider, "work");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["cursor", "grok", "fx"] as const)("starts %s login on Host with an operation identity", async provider => {
    await loginHarness(provider);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith("local", "providers.loginStart", { provider, operationId: expect.any(String) });
  });

  it("shares concurrent clicks until the Host request settles", async () => {
    let resolve!: () => void;
    mocks.accounts.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const first = loginHarness("codex"), second = loginHarness("codex");
    expect(second).toBe(first);
    resolve();
    await first;
    expect(mocks.accounts).toHaveBeenCalledOnce();
  });

  it("rejects an older Host before sending any command", async () => {
    mocks.descriptor.mockResolvedValue({ capabilities: [] });
    await expect(loginHarness("cursor")).rejects.toThrow("Update the Host");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("keeps unsupported providers and missing Host connections out of process execution", async () => {
    await expect(loginHarness("pi")).rejects.toThrow("single browser");
    mocks.machine.mockReturnValue("");
    await expect(loginHarness("fx")).rejects.toThrow("Connect to the shared Host");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
