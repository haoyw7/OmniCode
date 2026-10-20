// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionStatusPanel } from "./SessionStatusPanel";
import { usageSessionFor } from "../../providers/model/sessionUsage";
import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import {
  SessionHeaderActionsContext,
  type SessionHeaderActions,
} from "../../workspace/ui/SessionHeaderActions";
import {
  saveProviderAccount,
  selectProviderAccount,
} from "../../providers/model/providerAccounts";
import { clearCachedRateLimits, setCachedRateLimits } from "../../providers/model/rateLimitsCache";
import {
  idleRateLimits,
  RATE_LIMIT_MIN_REFETCH_MS,
  unavailableRateLimits,
} from "../../providers/model/rateLimits";
import { saveShowRemainingUsage } from "../../settings/model/displayPrefs";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { Session } from "../../sessions/model/session";
import type { DeepseekAccount } from "../../../integrations/harness/providers/deepseek/deepseekAccount";
import { configureSharedHost, remotePath } from "../../connections/model/remoteProjects";

const fetches = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
  opencode: vi.fn(),
  pi: vi.fn(),
  remote: vi.fn(),
}));
const hosts = vi.hoisted(() => ({ machines: [] as { id: string; environmentId: string; name: string }[] }));
vi.mock("../../connections/model/connections", async original => ({
  ...await original<typeof import("../../connections/model/connections")>(),
  remoteRequest: fetches.remote,
  useRemoteMachines: () => ({ machines: hosts.machines, loaded: true }),
  knownRemoteMachine: (environmentId: string) => hosts.machines.find(machine => machine.environmentId === environmentId),
}));
vi.mock("../../providers/model/piUsage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/model/piUsage")>()),
  fetchPiUsage: fetches.pi,
}));
vi.mock("../../providers/model/rateLimitsFetch", () => ({
  fetchCodexRateLimits: fetches.codex,
  fetchClaudeRateLimits: fetches.claude,
  fetchOpencodeGoRateLimits: fetches.opencode,
  consumeCodexRateLimitResetCredit: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let actions: SessionHeaderActions;
let sessions: Session[];
let deepseek: DeepseekAccount;

const quota = (usedPercent: number) => ({
  ...idleRateLimits("codex"),
  status: "ok" as const,
  session: { usedPercent, windowMinutes: 300, resetsAt: null },
  updatedAt: Date.now(),
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setUiLanguage("en");
  clearCachedRateLimits();
  configureSharedHost(undefined, []);
  hosts.machines = [];
  deepseek = {
    status: "credential-stored", profileStatus: "ready", profile: { name: "DSH user", contact: "155****95" },
    balanceStatus: "ready", wallets: [{ currency: "CNY", balance: "7.10985202" }],
    bonusWallets: [{ currency: "CNY", balance: "15.05836248" }],
  };
  fetches.remote.mockReset().mockImplementation(async (machine, method) => {
    if (method === "environment.describe") return {
      protocolVersion: 1, environmentId: machine === "remote-machine" ? "remote-env" : "shared-env",
      name: "Host", providers: ["deepseek"], capabilities: ["providerAccounts.deepseek.v1"],
    };
    if (method === "providerAccounts.deepseek") return deepseek;
    throw new Error(`Unexpected method ${method}`);
  });
  saveProviderAccount({
    provider: "codex",
    id: "account-left",
    label: "Left account",
  });
  saveProviderAccount({
    provider: "codex",
    id: "account-right",
    label: "Right account",
  });
  selectProviderAccount("codex", "/left", "account-right");
  selectProviderAccount("codex", "/right", "account-right");
  fetches.codex
    .mockReset()
    .mockImplementation(async (id) => quota(id === "account-left" ? 17 : 44));
  fetches.claude
    .mockReset()
    .mockResolvedValue(unavailableRateLimits("claude", "not signed in"));
  fetches.opencode
    .mockReset()
    .mockResolvedValue(unavailableRateLimits("opencode", "not connected"));
  fetches.pi
    .mockReset()
    .mockResolvedValue({ ...quota(23), provider: "claude" });
  actions = {
    rename: vi.fn(),
    archive: vi.fn(),
    splitRight: vi.fn(),
    terminalAvailable: true,
    toggleTerminal: vi.fn(),
    toggleFiles: vi.fn(),
    changesOpen: false,
    toggleChanges: vi.fn(),
  };
  sessions = ["left", "right"].map(
    (id) =>
      ({
        id,
        title: `${id} chat`,
        cwd: `/${id}`,
        harness: "codex",
        providerAccountId: `account-${id}`,
        blocks: [],
        model: "codex:default",
        modelSettings: {},
        runtimeMode: "supervised",
      }) satisfies Session,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target === container) this.callback([
        { target, borderBoxSize: [{ inlineSize: 1600, blockSize: 800 }] } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver);
    }
    disconnect() {}
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  configureSharedHost(undefined, []);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  const session = sessions[0];
  const scope = createRef<HTMLDivElement>();
  scope.current = container;
  await act(async () => root.render(
    createElement(SessionHeaderActionsContext.Provider, { value: actions },
      createElement(SessionStatusPanel, {
        blocks: session.blocks, busy: false, git: null,
        cwd: session.cwd, usage: usageSessionFor(session), scope, onNavigate: vi.fn(),
      }),
    ),
  ));
}

async function finishExits() {
  await act(async () => completeMotionAnimation(document.body));
}

const usageRow = () => container.querySelector<HTMLElement>("[data-session-usage]")!;
const usageChip = () => usageRow().querySelector<HTMLButtonElement>('[aria-label$="usage details"]')!;
const usageDetails = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label$="usage details"]');
const usageToggle = () => container.querySelector<HTMLButtonElement>('[data-status-card="usage"] button[aria-expanded]')!;
const remaining = () => container.querySelector<HTMLElement>("[data-session-usage-remaining]");

it("keeps the shortest-window quota current while folded, independently of headroom and the display preference", async () => {
  fetches.codex.mockResolvedValueOnce({
    ...quota(17),
    weekly: { usedPercent: 72, windowMinutes: 10080, resetsAt: null },
  });
  saveShowRemainingUsage(false);
  await render();
  expect(remaining()).toBeNull();
  act(() => usageToggle().click());
  await finishExits();
  expect(usageRow()).toBeNull();
  expect(remaining()?.textContent).toBe("5h remaining 83%");
  act(() => setCachedRateLimits("codex", "account-left", quota(60)));
  expect(remaining()?.textContent).toBe("5h remaining 40%");
  act(() => setCachedRateLimits("codex", "account-left", {
    ...quota(60),
    weekly: { usedPercent: 30, windowMinutes: 60, resetsAt: null },
  }));
  expect(remaining()?.textContent).toBe("1h remaining 70%");
  sessions[0] = sessions[1];
  await render();
  expect(remaining()?.textContent).toBe("5h remaining 56%");
  expect(fetches.codex).toHaveBeenLastCalledWith("account-right");
  await act(async () => usageToggle().click());
  await finishExits();
  expect(usageRow().textContent).toContain("56%");
  expect(remaining()).toBeNull();
  expect(fetches.codex).toHaveBeenCalledTimes(2);
});

it("loads usage when the card starts folded and distinguishes missing data from full quota", async () => {
  await render();
  act(() => usageToggle().click());
  await finishExits();
  act(() => root.render(null));
  clearCachedRateLimits();
  let resolveUsage!: (value: ReturnType<typeof quota>) => void;
  fetches.codex.mockImplementationOnce(() => new Promise((resolve) => { resolveUsage = resolve; }));
  await render();
  expect(usageToggle().getAttribute("aria-expanded")).toBe("false");
  expect(usageRow()).toBeNull();
  expect(remaining()?.textContent).toBe("Checking…");
  await act(async () => resolveUsage(quota(100)));
  expect(remaining()?.textContent).toBe("5h remaining 0%");
  act(() => setCachedRateLimits("codex", "account-left", unavailableRateLimits("codex", "not signed in")));
  expect(remaining()?.textContent).toBe("Usage unavailable");
  act(() => setCachedRateLimits("codex", "account-left", quota(0)));
  expect(remaining()?.textContent).toBe("5h remaining 100%");
  await act(async () => usageToggle().click());
  await finishExits();
});

it("keeps Pi's saved account usage active while folded without duplicate fetches", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  sessions[0] = { ...sessions[0], harness: "pi", model: "pi:anthropic/claude" };
  await render();
  act(() => usageToggle().click());
  await finishExits();
  expect(usageRow()).toBeNull();
  expect(remaining()?.textContent).toBe("5h remaining 77%");
  expect(fetches.pi).toHaveBeenCalledTimes(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + RATE_LIMIT_MIN_REFETCH_MS + 1);
  fetches.pi.mockResolvedValueOnce({ ...quota(45), provider: "claude" });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(remaining()?.textContent).toBe("5h remaining 55%");
  await act(async () => usageToggle().click());
  await finishExits();
  expect(usageRow().textContent).toContain("55%");
  expect(fetches.pi).toHaveBeenCalledTimes(2);
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(fetches.claude).not.toHaveBeenCalled();
});

it("shows the conversation's usage in its status card and keeps refresh and details available", async () => {
  await render();
  expect(container.querySelector('[data-status-card="usage"]')?.textContent).toContain("Usage");
  expect(fetches.codex).toHaveBeenCalledExactlyOnceWith("account-left");
  expect(usageRow().textContent).toContain("Left account");
  expect(usageRow().textContent).toContain("83%");
  await act(async () => usageRow().querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')!.click());
  expect(fetches.codex).toHaveBeenLastCalledWith("account-left");
  expect(fetches.codex).toHaveBeenCalledTimes(2);
  await act(async () => usageChip().click());
  expect(usageDetails()?.textContent).toContain("Left account");
  expect(usageDetails()?.textContent).toContain("17% used");
  expect(usageDetails()?.textContent).not.toContain("44%");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await finishExits();
  expect(usageDetails()).toBeNull();
  expect(usageRow()).not.toBeNull();
});

it("falls back to the owning project's account and keeps the card showing remaining capacity", async () => {
  sessions[0] = { ...sessions[0], providerAccountId: undefined };
  selectProviderAccount("codex", "/left", "account-left");
  await render();
  expect(fetches.codex).toHaveBeenCalledExactlyOnceWith("account-left");
  expect(usageRow().textContent).toContain("83%");
  act(() => saveShowRemainingUsage(true));
  expect(usageRow().textContent).toContain("83%");
});

it("uses the owning harness and reports disconnected/removed accounts without another account's fetch", async () => {
  sessions[0] = {
    ...sessions[0],
    harness: "claude",
    providerAccountId: "default",
  };
  await render();
  expect(fetches.claude).toHaveBeenCalledExactlyOnceWith("default");
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(usageChip().getAttribute("aria-label")).toContain("Claude Code");
  expect(usageRow().textContent).toContain("not connected");
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  sessions[0] = {
    ...sessions[0],
    harness: "codex",
    providerAccountId: "account-removed",
  };
  await render();
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(usageRow().textContent).toContain("Usage unavailable");
  await act(async () => usageChip().click());
  // A removed account still offers switching, rather than signing in to an invalid profile.
  expect(usageDetails()?.textContent).toContain("Removed account");
  expect(usageDetails()?.textContent).not.toContain("Sign in to Codex");
});

it("uses the status card session's Pi model and saved OAuth usage without querying a Codex/Claude profile", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  sessions[0] = {
    ...sessions[0],
    harness: "pi",
    model: "pi:anthropic/claude-sonnet-4-6",
  };
  await render();
  expect(fetches.pi).toHaveBeenCalledExactlyOnceWith("anthropic");
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(fetches.claude).not.toHaveBeenCalled();
  expect(usageChip().getAttribute("aria-label")).toContain("Pi · Anthropic");
  expect(usageRow().textContent).toContain("77%");
  await act(async () =>
    usageRow()
      .querySelector<HTMLButtonElement>('[aria-label="Refresh Pi usage"]')!
      .click(),
  );
  expect(fetches.pi).toHaveBeenCalledTimes(2);
  await act(async () => usageChip().click());
  expect(usageDetails()?.textContent).toContain("Pi's saved OAuth account");
});

it("switches the owning conversation's account from the status card details", async () => {
  actions.selectProviderAccount = vi.fn();
  await render();
  await act(async () => usageChip().click());
  await act(async () =>
    usageDetails()!
      .querySelector<HTMLButtonElement>('[aria-label^="Switch"]')!
      .click(),
  );
  const right = usageDetails()!.querySelector<HTMLButtonElement>(
    '[aria-label="Right account"]',
  )!;
  await act(async () => right.click());
  expect(actions.selectProviderAccount).toHaveBeenCalledExactlyOnceWith(
    "left",
    "codex",
    "account-right",
  );
  await finishExits();
  expect(usageDetails()).toBeNull();
  await finishExits();
  expect(usageRow()).not.toBeNull();
});

it("omits usage for harnesses without account usage", async () => {
  sessions[0] = { ...sessions[0], harness: "omp" };
  await render();
  expect(container.querySelector('[data-status-card="usage"]')).toBeNull();
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(fetches.claude).not.toHaveBeenCalled();
});

function useDeepseekSession(model = 'deepseek:["deepseek-account","deepseek-flash"]') {
  configureSharedHost("shared-env", [], "shared-machine");
  sessions[0] = { ...sessions[0], harness: "deepseek", model };
}

it("shows and refreshes DSH account wallets in the conversation usage card", async () => {
  useDeepseekSession();
  await render();
  expect(usageRow().textContent).toContain("DSH user");
  expect(usageRow().textContent).toContain("155****95");
  expect(usageRow().textContent).toContain("Balance: 7.10985202 CNY");
  expect(usageRow().textContent).toContain("Bonus balance: 15.05836248 CNY");
  expect(fetches.remote).toHaveBeenCalledWith("shared-machine", "providerAccounts.deepseek", {
    client: { version: expect.any(String), locale: "en", timezoneOffsetSeconds: expect.any(Number) },
  });
  deepseek = { ...deepseek, wallets: [{ currency: "USD", balance: "0.00" }] };
  await act(async () => usageRow().querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')!.click());
  expect(usageRow().textContent).toContain("Balance: 0.00 USD");
  expect(usageRow().textContent).not.toContain("7.10985202");
  expect(fetches.remote.mock.calls.filter(([, method]) => method === "providerAccounts.deepseek")).toHaveLength(2);
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(fetches.claude).not.toHaveBeenCalled();
});

it.each([
  'deepseek:["deepseek-official","deepseek-flash"]',
  'deepseek:["custom-api","deepseek-flash"]',
  "deepseek:default",
  'deepseek:["deepseek-account"]',
])("omits DSH account usage and account queries for %s", async model => {
  useDeepseekSession(model);
  sessions[0].blocks = [{ id: "error", role: "system", notice: "error", text: "Please sign in" }];
  await render();
  expect(container.querySelector('[data-status-card="usage"]')).toBeNull();
  expect(fetches.remote).not.toHaveBeenCalled();
});

it("keeps DSH balances current while the usage card is folded", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  useDeepseekSession();
  await render();
  act(() => usageToggle().click());
  await finishExits();
  expect(usageRow()).toBeNull();
  expect(remaining()?.textContent).toBe("Balance: 7.10985202 CNY");
  deepseek = { ...deepseek, wallets: [{ currency: "CNY", balance: "6.50" }] };
  await act(async () => vi.advanceTimersByTime(15 * 60_000));
  expect(remaining()?.textContent).toBe("Balance: 6.50 CNY");
  await act(async () => usageToggle().click());
  await finishExits();
  expect(usageRow().textContent).toContain("Balance: 6.50 CNY");
  expect(fetches.remote.mock.calls.filter(([, method]) => method === "providerAccounts.deepseek")).toHaveLength(2);
});

it("removes DSH account usage when switching to an API route and ignores the previous response", async () => {
  useDeepseekSession();
  let complete!: (value: DeepseekAccount) => void;
  const request = fetches.remote.getMockImplementation()!;
  fetches.remote.mockImplementation((machine, method) => method === "providerAccounts.deepseek"
    ? new Promise(resolve => { complete = resolve; }) : request(machine, method));
  await render();
  expect(usageRow().textContent).toContain("Checking…");
  sessions[0] = { ...sessions[0], model: 'deepseek:["custom-api","deepseek-flash"]' };
  await render();
  await finishExits();
  await act(async () => (globalThis as { __advanceTestWebAnimations?: (elapsed: number) => void }).__advanceTestWebAnimations?.(1_000));
  await act(async () => complete(deepseek));
  expect(container.querySelector('[data-status-card="usage"]')).toBeNull();
  expect(container.textContent).not.toContain("DSH user");
});

it("uses the conversation's remote Host and clears the previous Host's balances", async () => {
  useDeepseekSession();
  await render();
  expect(usageRow().textContent).toContain("DSH user");
  hosts.machines = [{ id: "remote-machine", environmentId: "remote-env", name: "Remote" }];
  sessions[0] = { ...sessions[0], cwd: remotePath("remote-env", "/project") };
  let complete!: (value: DeepseekAccount) => void;
  const request = fetches.remote.getMockImplementation()!;
  fetches.remote.mockImplementation((machine, method) => method === "providerAccounts.deepseek"
    ? new Promise(resolve => { complete = resolve; }) : request(machine, method));
  await render();
  expect(usageRow().textContent).not.toContain("DSH user");
  expect(fetches.remote).toHaveBeenLastCalledWith("remote-machine", "providerAccounts.deepseek", expect.any(Object));
  await act(async () => complete({ ...deepseek, profile: { name: "Remote user", contact: null }, wallets: [{ currency: "USD", balance: "2.00" }] }));
  expect(usageRow().textContent).toContain("Remote user");
  expect(usageRow().textContent).toContain("Balance: 2.00 USD");
  expect(usageRow().textContent).not.toContain("7.10985202");
});

it("clears stale DSH balances after errors and sign-out, keeping app copy localized", async () => {
  useDeepseekSession();
  setUiLanguage("zh-CN");
  await render();
  expect(usageRow().textContent).toContain("DSH user");
  expect(usageRow().textContent).toContain("赠送余额：15.05836248 CNY");
  const request = fetches.remote.getMockImplementation()!;
  fetches.remote.mockImplementation((machine, method) => {
    if (method === "providerAccounts.deepseek") throw new Error("private provider error");
    return request(machine, method);
  });
  const refresh = () => usageRow().querySelector<HTMLButtonElement>('[aria-label="刷新用量"]')!;
  await act(async () => refresh().click());
  expect(usageRow().textContent).not.toContain("DSH user");
  expect(usageRow().textContent).not.toContain("7.10985202");
  expect(usageRow().textContent).not.toContain("private provider error");
  expect(usageRow().textContent).toContain("无法读取 DeepSeek 账号");
  deepseek = { status: "signed-out" };
  fetches.remote.mockImplementation(request);
  await act(async () => refresh().click());
  expect(usageRow().textContent).toContain("未登录");
  expect(usageRow().textContent).not.toContain("余额：");
});

it("does not show the shared Host's DSH account for a disconnected remote conversation", async () => {
  useDeepseekSession();
  sessions[0] = { ...sessions[0], cwd: remotePath("remote-env", "/project") };
  await render();
  expect(usageRow().textContent).toContain("Connect to the conversation's Host");
  expect(usageRow().textContent).not.toContain("DSH user");
  expect(fetches.remote).not.toHaveBeenCalled();
});

it("closes the usage portal when its card folds and supports reopening", async () => {
  await render();
  await act(async () => usageChip().click());
  expect(usageDetails()).not.toBeNull();
  const toggle = container.querySelector<HTMLButtonElement>('[data-status-card="usage"] button[aria-expanded]')!;
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[data-status-card="usage"] [data-fold-state="closing"][inert]')).not.toBeNull();
  await finishExits();
  expect(usageDetails()).toBeNull();
  await act(async () => toggle.click());
  await finishExits();
  await act(async () => usageChip().click());
  expect(usageDetails()).not.toBeNull();
});

it("localizes usage controls while preserving account names", async () => {
  setUiLanguage("zh-CN");
  await render();
  expect(container.querySelector('[data-status-card="usage"] h3')?.textContent).toBe("用量");
  expect(usageRow().querySelector('[aria-label$="用量详情"]')).not.toBeNull();
  expect(usageRow().querySelector('[aria-label="刷新用量"]')).not.toBeNull();
  expect(usageRow().textContent).toContain("Left account");
  act(() => usageToggle().click());
  await finishExits();
  expect(remaining()?.textContent).toBe("5h 剩余 83%");
  act(() => setCachedRateLimits("codex", "account-left", {
    ...quota(100),
    session: { usedPercent: 100, windowMinutes: 300, resetsAt: Date.now() - 60_000 },
    weekly: { usedPercent: 72, windowMinutes: 10080, resetsAt: Date.now() + 86400_000 },
  }));
  expect(remaining()?.textContent).toBe("5h 剩余 100%");
  act(() => setCachedRateLimits("codex", "account-left", {
    ...quota(17),
    session: null,
    weekly: { usedPercent: 72, windowMinutes: 10080, resetsAt: null },
    monthly: { usedPercent: 81, windowMinutes: 43200, resetsAt: null },
  }));
  expect(remaining()?.textContent).toBe("周剩余 28%");
  act(() => setCachedRateLimits("codex", "account-left", {
    ...quota(17),
    session: null,
    monthly: { usedPercent: 81, windowMinutes: 43200, resetsAt: null },
  }));
  expect(remaining()?.textContent).toBe("月剩余 19%");
  act(() => setCachedRateLimits("codex", "account-left", {
    ...quota(25),
    session: { usedPercent: 25, windowMinutes: 120, resetsAt: Date.now() + 1800_000 },
  }));
  expect(remaining()?.textContent).toBe("2h 剩余 75%");
  await act(async () => usageToggle().click());
  await finishExits();
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
