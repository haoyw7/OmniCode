import { beforeEach, describe, expect, it, vi } from "vitest";

const hostLogin = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../features/providers/model/providerAccountCredentials", () => ({ loginProviderAccount: hostLogin }));

const child = vi.hoisted(() => ({
  killChild: vi.fn(async () => undefined),
  spawnChild: vi.fn(async () => undefined),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  resolveClaudeBinary: vi.fn(async () => ({ path: "/bin/claude" })),
  resolveCodexBinary: vi.fn(async () => ({ path: "/bin/codex" })),
  resolveCursorBinary: vi.fn(async () => ({ path: "/bin/agent" })),
  resolveGrokBinary: vi.fn(async () => ({ path: "/bin/grok" })),
  resolveFxBinary: vi.fn(async () => ({ path: "/bin/fx" })),
}));

vi.mock("./child", () => child);
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: vi.fn(async () => "/home/alice") }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "test-window" }),
}));

import {
  harnessLoginArgs,
  isHarnessAuthError,
  latestTurnNeedsHarnessLogin,
  loginHarness,
  resetHarnessLoginState,
  supportsHarnessLogin,
} from "./auth";

beforeEach(() => {
  resetHarnessLoginState();
  vi.clearAllMocks();
});

describe("harness login", () => {
  it("advertises only deterministic account login commands", () => {
    expect(harnessLoginArgs("claude")).toEqual(["auth", "login"]);
    expect(harnessLoginArgs("codex")).toEqual(["login"]);
    expect(harnessLoginArgs("cursor")).toEqual(["login"]);
    expect(harnessLoginArgs("grok")).toEqual(["login", "--oauth"]);
    expect(harnessLoginArgs("fx")).toEqual(["login", "vercel"]);
    expect(supportsHarnessLogin("opencode")).toBe(false);
    expect(supportsHarnessLogin("pi")).toBe(false);
    expect(supportsHarnessLogin("omp")).toBe(false);
  });

  it("recognizes provider authentication failures without matching unrelated errors", () => {
    expect(
      isHarnessAuthError(
        "Authentication required\n\nGrok Build is not signed in. Run `grok login` in a terminal.",
      ),
    ).toBe(true);
    expect(isHarnessAuthError("Claude sign-in expired")).toBe(true);
    expect(isHarnessAuthError("Provider request timed out")).toBe(false);
  });

  it("only carries an authentication failure through its current turn", () => {
    const error = {
      role: "system" as const,
      notice: "error" as const,
      text: "Grok Build is not signed in.",
    };
    expect(latestTurnNeedsHarnessLogin([error])).toBe(true);
    expect(
      latestTurnNeedsHarnessLogin([
        error,
        { role: "user", text: "Retry this", notice: undefined },
      ]),
    ).toBe(false);
  });

  it.each(["claude", "codex"] as const)("delegates %s login and account selection to Host", async provider => {
    await loginHarness(provider, "account-work");
    expect(hostLogin).toHaveBeenCalledWith(provider, "account-work");
    expect(child.spawnChild).not.toHaveBeenCalled();
  });

  it("deduplicates repeated Host login clicks", async () => {
    let complete!: () => void;
    hostLogin.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = loginHarness("codex");
    const second = loginHarness("codex");
    expect(second).toBe(first);
    expect(hostLogin).toHaveBeenCalledOnce();
    complete();
    await first;
  });

  it("keeps provider-owned browser login for harnesses without account profiles", async () => {
    const login = loginHarness("cursor");
    await vi.waitFor(() => expect(child.watchChild).toHaveBeenCalledOnce());
    expect(child.spawnChild).toHaveBeenCalledWith("monocode-provider-login-test-window-cursor", "/bin/agent", ["login"], "/home/alice", undefined, "cursor");
    const onExit = child.watchChild.mock.calls[0]?.[2] as ((code: number | null) => void) | undefined;
    onExit?.(0);
    await expect(login).resolves.toBeUndefined();
  });

  it("does not invent one login flow for multi-provider harnesses", async () => {
    await expect(loginHarness("opencode")).rejects.toThrow(
      "does not offer a single browser sign-in flow",
    );
    expect(child.spawnChild).not.toHaveBeenCalled();
  });
});
