import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import { configureSharedHost } from "../../connections/model/remoteProjects";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { SettingsView } from "./SettingsView";
import * as scrollWithinModule from "../../../shared/lib/scrollWithin";
import { loginHarness } from "../../../integrations/harness/core/auth";
import * as harnessRegistry from "../../../integrations/harness/core/registry";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../sessions/model/models";
import { AppViewDialog } from "../../workspace/ui/AppViewDialog";
import {
  refreshUiLanguage,
  UI_LANGUAGE_KEY,
} from "../../../shared/i18n/language";
import { rememberNotificationProjects } from "../../notifications/model/notificationProjects";
import {
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "../model/settings";
import {
  providerAccounts,
  saveProviderAccount,
} from "../../providers/model/providerAccounts";
import {
  clearCachedRateLimits,
  setCachedRateLimits,
} from "../../providers/model/rateLimitsCache";
import { HARNESSES, HARNESS_TITLE } from "../../sessions/model/session";
import { saveMaskEmails, saveShowRemainingUsage } from "../model/displayPrefs";

const windowMock = vi.hoisted(() => ({
  nativeDesktop: false,
  startDragging: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
  isTauri: () => windowMock.nativeDesktop,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: windowMock.startDragging,
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
vi.mock("../../../platform/tauri/platform", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/platform")>()),
  IS_LINUX: true,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../integrations/harness/core/auth", () => ({ loginHarness: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: (id: string) => id === "claude" || id === "cursor",
  hasProbedHarnessAvailability: () => true,
  getHarnessAvailabilitySnapshot: () => 0,
  subscribeHarnessAvailability: () => () => {},
  probeHarnessAvailability: async () => {},
  harnessUnavailableHint: () => "",
}));

let container: HTMLDivElement;
let root: Root;
let onSelectSection: ReturnType<typeof vi.fn>;

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
}

async function render(
  section: SettingsSectionId,
  options: Partial<ComponentProps<typeof SettingsView>> = {},
) {
  await act(async () =>
    root.render(
      createElement(SettingsView, {
        section,
        cwd: "/repo",
        sessions: [],
        onClose: vi.fn(),
        onSelectSection,
        onOpenSession: vi.fn(),
        onArchiveSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenWhatsNew: vi.fn(),
        ...options,
      }),
    ),
  );
  await act(async () => container.querySelectorAll('[data-settings-page][aria-hidden="true"]').forEach(completeMotionAnimation));
}

/** Opens an account row's ⋯ menu and returns the named item. */
async function accountMenuItem(
  account: string,
  item: string,
  root: ParentNode = container,
) {
  await act(async () =>
    root
      .querySelector<HTMLButtonElement>(`[aria-label="Actions for ${account}"]`)!
      .click(),
  );
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((button) => !button.closest("[inert]") && button.textContent?.includes(item));
}

/** A row signs in from its button when logged out, else from the ⋯ menu. */
async function signInTo(account: string, root: ParentNode = container) {
  const direct = root.querySelector<HTMLButtonElement>(
    `[aria-label="Sign in to ${account}"]`,
  );
  const target =
    direct ?? (await accountMenuItem(account, "Sign in again", root))!;
  await act(async () => target.click());
}

function renderedSettingIds(): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-setting-id]"),
    (node) => node.dataset.settingId!,
  );
}

/** In-memory Host contract; UI tests never publish a browser account catalog. */
function mockAccountHost(options: {
  accounts?: Record<string, { id: string; label: string; dataHome?: string }[]>;
  identity?: (provider: string, accountId: string, home?: string) => Record<string, string> | undefined;
  offline?: () => boolean;
  setDefault?: () => void;
  imported?: () => void;
} = {}) {
  configureSharedHost("env", [], "shared-machine");
  let accounts = options.accounts;
  let revision = 1;
  const defaults: Record<string, string> = {};
  const catalog = () => accounts ??= Object.fromEntries(["claude", "codex"].map(provider => [provider,
    providerAccounts(provider as "claude" | "codex").map(({ id, label }) => ({ id, label })),
  ]));
  const publicAccounts = () => Object.fromEntries(Object.entries(catalog()).map(([provider, entries]) => [provider,
    entries.map(({ id, label, dataHome }) => ({ id, label, identity: options.identity?.(provider, id, dataHome) })),
  ]));
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return undefined;
    const { method, params } = args as { method: string; params: Record<string, string> };
    if (method === "environment.describe") return { protocolVersion: 1, environmentId: "env", name: "fixture", providers: ["claude", "codex"], capabilities: ["providerAccounts.manage.v1"] };
    if (method === "providerAccounts.list") {
      if (options.offline?.()) throw new Error("Host offline");
      return publicAccounts();
    }
    if (method === "providerAccounts.save" || method === "providerAccounts.importCodex") {
      const entries = catalog()[params.provider] ??= [];
      const entry = entries.find(entry => entry.id === params.accountId);
      if (entry) { entry.label = params.label; if (params.dataHome !== undefined) entry.dataHome = params.dataHome; }
      else entries.push({ id: params.accountId, label: params.label, dataHome: params.dataHome });
      if (method === "providerAccounts.importCodex") options.imported?.();
      revision++;
    } else if (method === "providerAccounts.remove") {
      catalog()[params.provider] = catalog()[params.provider].filter(entry => entry.id !== params.accountId); revision++;
    } else if (method === "providerAccounts.setDefault") {
      options.setDefault?.(); defaults[params.provider] = params.accountId; revision++;
    }
    if (method === "providerAccounts.read" || method === "providerAccounts.save" || method === "providerAccounts.remove" || method === "providerAccounts.setDefault" || method === "providerAccounts.importCodex")
      return { revision, accounts: publicAccounts(), defaults: { ...defaults } };
    return undefined;
  });
}

beforeEach(() => {
  windowMock.nativeDesktop = false;
  windowMock.startDragging.mockClear();
  vi.mocked(loginHarness).mockReset().mockResolvedValue(undefined);
  configureSharedHost(undefined, []);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  refreshUiLanguage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSelectSection = vi.fn();
  vi.mocked(invoke).mockReset();
  mockAccountHost();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearCachedRateLimits();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("settings pages", () => {
  it.each(["claude", "grok"] as const)(
    "refreshes a cached %s model list on each open only when the provider is available",
    async (harness) => {
      setHarnessModels(harness, [
        { id: `${harness}:cached`, harness, name: "Cached model" },
      ]);
      const refresh = vi
        .spyOn(harnessRegistry, "refreshHarnessCatalogs")
        .mockImplementation(async (ids) => {
          if ([...ids].includes(harness)) {
            setHarnessModels(harness, [
              { id: `${harness}:cached`, harness, name: "Cached model" },
              { id: `${harness}:new`, harness, name: "New model" },
            ]);
          }
        });
      try {
        await render("providers");
        refresh.mockClear();
        const trigger = container.querySelector<HTMLButtonElement>(
          `[aria-label^="${HARNESS_TITLE[harness]} model:"]`,
        )!;
        await act(async () => trigger.click());
        if (harness === "claude") {
          expect(refresh).toHaveBeenCalledExactlyOnceWith([harness], { force: true });
          expect(document.querySelector('[role="listbox"]')?.textContent).toContain("New model");
          // The catalog update rerenders the open picker without probing again.
          await render("providers");
          expect(refresh).toHaveBeenCalledTimes(1);
        } else {
          expect(refresh).not.toHaveBeenCalled();
        }
        await act(async () => trigger.click());
        await act(async () => trigger.click());
        expect(refresh).toHaveBeenCalledTimes(harness === "claude" ? 2 : 0);
      } finally {
        await act(async () => resetHarnessModelOverlays());
      }
    },
  );

  it("drags the window from the popup header while preserving search, actions, close and body interaction", async () => {
    windowMock.nativeDesktop = true;
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(AppViewDialog, {
          title: "Settings",
          onClose,
          children: createElement(SettingsView, {
            section: "appearance",
            cwd: "/repo",
            sessions: [],
            onClose,
            onSelectSection,
            onOpenSession: vi.fn(),
            onArchiveSession: vi.fn(),
            onDeleteSession: vi.fn(),
            onOpenWhatsNew: vi.fn(),
          }),
        }),
      ),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains("app-view-dialog")).toBe(true);
    const header = dialog.querySelector(
      '[data-app-settings] > [data-window-drag-region="deep"]',
    )!;
    const press = (target: Element) => {
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        clientX: 100,
        clientY: 100,
      });
      act(() => target.dispatchEvent(event));
      return event;
    };
    expect(press(header.querySelector("span")!).defaultPrevented).toBe(true);
    expect(windowMock.startDragging).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    windowMock.startDragging.mockClear();
    const close = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Close"]',
    )!;
    for (const target of [
      header.querySelector('input[aria-label="Search settings"]')!,
      header.querySelector("button svg")!,
      close.querySelector("svg")!,
      dialog.querySelector("[data-setting-id]")!,
    ]) {
      expect(press(target).defaultPrevented).toBe(false);
    }
    expect(windowMock.startDragging).not.toHaveBeenCalled();
    act(() => close.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("only leaves Settings on Escape while its workspace pane is active", async () => {
    const onClose = vi.fn();
    await render("general", { active: false, onClose });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await render("general", { active: true, onClose });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("switches English and Chinese in place and remembers the selected language", async () => {
    await render("general");
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search settings"]',
    )!;
    const chinese = [
      ...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((button) => button.textContent === "简体中文")!;
    expect(chinese).toBeDefined();
    await act(async () => chinese.click());
    expect(localStorage.getItem(UI_LANGUAGE_KEY)).toBe("zh-CN");
    expect(
      container.querySelector('[role="region"]')?.getAttribute("aria-label"),
    ).toBe("设置");
    expect(container.querySelector('input[aria-label="搜索设置"]')).toBe(
      search,
    );
    expect(container.textContent).toContain("界面语言");
    expect(document.documentElement.lang).toBe("zh-CN");
    const english = [
      ...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((button) => button.textContent === "English")!;
    await act(async () => english.click());
    expect(localStorage.getItem(UI_LANGUAGE_KEY)).toBe("en");
    expect(container.querySelector('input[aria-label="Search settings"]')).toBe(
      search,
    );
    expect(
      container.querySelector('[role="region"]')?.getAttribute("aria-label"),
    ).toBe("Settings");
  });

  it("blurs account emails by default and hides them when settings reopen", async () => {
    mockAccountHost({ identity: provider => ({ email: `${provider}@example.com`, plan: "Pro" }) });
    await render("providers");

    const emails = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Reveal email"]',
    );
    expect(emails).toHaveLength(2);
    expect(
      [...emails].every((email) =>
        email.querySelector("span")?.className.includes("blur-[5px]"),
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Pro");
    await act(async () => emails[0].click());
    expect(emails[0].getAttribute("aria-label")).toBe("Hide email");
    expect(emails[0].querySelector("span")?.className).not.toContain("blur");
    expect(emails[1].getAttribute("aria-label")).toBe("Reveal email");
    await act(async () => emails[0].click());
    expect(emails[0].getAttribute("aria-label")).toBe("Reveal email");

    await act(async () => emails[0].click());
    await render("general");
    await render("providers");
    expect(container.querySelector('[aria-label="Hide email"]')).toBeNull();
    expect(
      container.querySelectorAll('[aria-label="Reveal email"]'),
    ).toHaveLength(2);
  });

  it("shows used usage and plain emails until the options are turned on", async () => {
    saveMaskEmails(false);
    mockAccountHost({ identity: () => ({ email: "user@example.com", plan: "Pro" }) });
    setCachedRateLimits("claude", "default", {
      provider: "claude",
      session: {
        usedPercent: 23,
        windowMinutes: 300,
        resetsAt: Date.now() + 3_600_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    });

    await render("providers");

    const used = container.querySelector('[aria-label="5h limit used"]');
    expect(used?.getAttribute("aria-valuenow")).toBe("23");
    expect(used?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 23%;",
    );
    expect(container.textContent).toContain("user@example.com");
    expect(container.querySelector('[aria-label="Reveal email"]')).toBeNull();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show remaining usage"]',
        )!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Mask account emails"]')!
        .click(),
    );

    const remaining = container.querySelector(
      '[aria-label="5h limit remaining"]',
    );
    expect(remaining?.getAttribute("aria-valuenow")).toBe("77");
    expect(
      container.querySelectorAll('[aria-label="Reveal email"]').length,
    ).toBeGreaterThan(0);
  });

  it("shows each profile's Host account independently from its label and refreshes identity", async () => {
    let workEmail = "work@example.com";
    let hostOffline = false;
    mockAccountHost({
      accounts: { codex: [{ id: "default", label: "Default" }, { id: "work", label: "Work", dataHome: "/homes/codex-work" }, { id: "personal", label: "Personal" }], claude: [{ id: "operator", label: "Claude profile" }] },
      identity: (provider, id) => id === "default" ? { email: "host@example.com" }
        : provider === "claude" ? { name: "Claude operator", plan: "Max" }
        : { email: id === "personal" ? "personal@example.com" : workEmail },
      offline: () => hostOffline,
    });
    await render("providers");
    const identity = (provider: string, id: string) => container.querySelector(`[data-provider-account-identity="${provider}:${id}"]`)!;
    expect(identity("codex", "work").textContent).toContain("work@example.com");
    expect(identity("codex", "personal").textContent).toContain("personal@example.com");
    expect(identity("claude", "operator").textContent).toContain("Claude operator");
    expect(identity("codex", "default").textContent).toContain("host@example.com");
    expect(container.textContent).not.toContain("/homes/codex-work");
    const refresh = () => act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh usage limits"]')!.click());
    workEmail = "updated@example.com";
    await refresh();
    expect(identity("codex", "work").textContent).toContain("updated@example.com");
    hostOffline = true;
    await refresh();
    expect(identity("codex", "work").textContent).toContain("No account identity could be read");
    expect(invoke).not.toHaveBeenCalledWith("provider_account_identity", expect.anything());
  });

  it.each(["codex", "claude"] as const)("edits the built-in %s Home on Host without exposing its private path", async provider => {
    mockAccountHost({ identity: (_provider, _id, dataHome) => ({ email: `${dataHome === "/custom/home" ? "changed" : "initial"}@example.com`, plan: "Pro" }) });
    await render("providers");
    const identity = () => container.querySelector(`[data-provider-account-identity="${provider}:default"]`)!;
    expect(identity().textContent).toContain("initial@example.com");
    expect(container.textContent).toContain("Data Home is managed by Host");
    expect(container.textContent).toContain("Built-in CLI profile");
    const row = identity().parentElement!.parentElement!;
    expect(row.querySelector('[title="Edit account and Data Home"]')).not.toBeNull();
    await act(async () => row.querySelector<HTMLButtonElement>('[title="Edit account and Data Home"]')!.click());
    const homeInput = container.querySelector<HTMLInputElement>(`[aria-label="${HARNESS_TITLE[provider]} Data Home"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(homeInput, "/custom/home");
      homeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => homeInput.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(providerAccounts(provider)[0]).toMatchObject({ id: "default" });
    expect(providerAccounts(provider)[0]).not.toHaveProperty("dataHome");
    expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.save", params: expect.objectContaining({ provider, accountId: "default", dataHome: "/custom/home" }) }));
    expect(providerAccounts(provider)).toHaveLength(1);
    expect(identity().textContent).toContain("changed@example.com");
    await signInTo("Default account", row);
    expect(loginHarness).toHaveBeenCalledWith(provider, "default");
  });

  it("shows account usage bars as remaining capacity", async () => {
    saveShowRemainingUsage(true);
    setCachedRateLimits("claude", "default", {
      provider: "claude",
      session: {
        usedPercent: 23,
        windowMinutes: 300,
        resetsAt: Date.now() + 3_600_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    });

    await render("providers");

    const bar = container.querySelector('[aria-label="5h limit remaining"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("77");
    expect(bar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 77%;",
    );
    expect(bar?.parentElement?.textContent).toContain("77% left");
  });

  it("shows background effect choices above scope when artwork is available", async () => {
    localStorage.setItem(
      "omnicode.chatBackgroundPath",
      "/app-data/backgrounds/chat-background.png",
    );
    await render("appearance");

    const effect = container.querySelector(
      "#new-thread-background-effect-dither",
    )!;
    const effectRow = effect.closest(".settings-row")!;
    const scopeRow = container
      .querySelector('[aria-label="Show background on"]')!
      .closest(".settings-row")!;
    expect(effect).not.toBeNull();
    expect(
      effectRow.compareDocumentPosition(scopeRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await act(async () => (effect as HTMLButtonElement).click());
    expect(localStorage.getItem("omnicode.newThreadBackgroundEffect")).toBe(
      "dither",
    );
    expect(effect.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain(
      "Rebuilds the artwork with a dithered color palette.",
    );
  });

  it("previews and restores Haze with the existing empty-chat visibility", async () => {
    localStorage.setItem("omnicode.chatBackgroundPath", "/background.png");
    localStorage.setItem("omnicode.chatBackgroundEmptyOpacity", "0.4");
    await render("appearance");

    const option = container.querySelector<HTMLButtonElement>(
      "#new-thread-background-effect-gradient-blur",
    )!;
    expect(option.textContent).toBe("Haze");
    await act(async () => option.click());

    const preview = container.querySelector<HTMLElement>(
      ".gradient-blur-background",
    )!;
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(preview.style.opacity).toBe("0.4");
    expect(preview.querySelectorAll("span")).toHaveLength(2);
    expect(localStorage.getItem("omnicode.newThreadBackgroundEffect")).toBe(
      "gradient-blur",
    );

    await render("providers");
    await render("appearance");
    expect(
      container
        .querySelector("#new-thread-background-effect-gradient-blur")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector(".gradient-blur-background")).not.toBeNull();
  });

  it("manages named accounts independently for each supported provider", async () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Wrk",
    });
    await render("providers");

    expect(container.textContent).toContain("Claude Code");
    expect(container.textContent).toContain("Codex");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Rename Default account"]',
        )!
        .click(),
    );
    const defaultInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Rename Claude Code account"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(defaultInput, "Primary");
      defaultInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(providerAccounts("claude")[0]?.label).toBe("Primary");
    await act(async () => container.querySelectorAll('[data-fold-state="closing"]').forEach(completeMotionAnimation));

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Rename Wrk"]')!
        .click(),
    );
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Rename Codex account"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Work");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(providerAccounts("codex")[1]?.label).toBe("Work");

    const remove = (await accountMenuItem("Work", "Remove account"))!;
    await act(async () => remove.click());
    expect(ask).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.remove", params: expect.objectContaining({ provider: "codex", accountId: "account-work" }) }));
    expect(providerAccounts("codex")).toHaveLength(1);
  });

  it.each(["codex", "claude"] as const)("adds a visible %s profile with an existing Home without signing in", async provider => {
    mockAccountHost({ accounts: { codex: [{ id: "default", label: "Default account" }, { id: "disk", label: "Disk account", dataHome: "/data/existing" }], claude: [{ id: "default", label: "Default account" }] } });
    await render("providers");
    expect(container.textContent).toContain("Disk account");
    expect(container.textContent).not.toContain("/data/existing");
    expect(container.textContent).toContain("Data Home is managed by Host");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent === "Add account");
    await act(async () => buttons[provider === "claude" ? 0 : 1].click());
    const name = container.querySelector<HTMLInputElement>(`[aria-label="New ${HARNESS_TITLE[provider]} account"]`)!;
    const home = container.querySelector<HTMLInputElement>(`[aria-label="${HARNESS_TITLE[provider]} Data Home"]`)!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "Personal"); name.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(home, `/data/${provider}`); home.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => name.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    const account = providerAccounts(provider).find(account => account.label === "Personal")!;
    expect(account.dataHome).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.save", params: expect.objectContaining({ provider, dataHome: `/data/${provider}` }) }));
    expect(container.querySelector('[aria-label="Rename Personal"]')).not.toBeNull();
    expect(container.textContent).not.toContain(`/data/${provider}`);
    expect(loginHarness).not.toHaveBeenCalled();
    await signInTo("Personal");
    expect(loginHarness).toHaveBeenCalledWith(provider, account.id);
  });

  it("validates and stores Codex and OpenCode binary overrides", async () => {
    let failAutoCodex = false;
    const accountHost = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "remote_request") return accountHost(command, args);
      const payload = args as { binaryPath?: string } | undefined;
      if (command === "harness_resolve_configured") {
        return { path: payload?.binaryPath };
      }
      if (command === "harness_resolve_codex") {
        if (failAutoCodex && payload?.binaryPath == null) {
          throw new Error("Codex auto-detection failed");
        }
        return { path: payload?.binaryPath ?? "/auto/codex" };
      }
      if (command === "harness_resolve_opencode") {
        return { path: payload?.binaryPath ?? "/auto/opencode" };
      }
      if (command === "harness_exec") {
        if (payload?.binaryPath === "/bad/codex") {
          throw new Error("Codex failed to start");
        }
        return payload?.binaryPath?.includes("opencode")
          ? "opencode 1.18.32"
          : "codex-cli 0.156.1";
      }
      return undefined;
    });
    await render("providers");

    const details = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show Codex CLI details"]',
    )!;
    await act(async () => details.click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open Codex CLI location"]',
        )!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith("reveal_path", {
      path: "/auto/codex",
    });

    const save = async (provider: "Codex" | "OpenCode", path: string) => {
      const id = `${provider.toLowerCase()}-binary-path`;
      const edit = () => [...document.querySelectorAll<HTMLButtonElement>(`[aria-label="Edit ${provider} CLI path"]`)]
        .find(button => !button.closest('[aria-hidden="true"]'));
      if (!document.querySelector(`#${id}`)) {
        if (
          !edit()
        ) {
          await act(async () =>
            container
              .querySelector<HTMLButtonElement>(
                `[aria-label^="Show ${provider} CLI details"]`,
              )!
              .click(),
          );
        }
        await act(async () =>
          edit()!.click(),
        );
      }
      const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, path);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => input.closest("form")!.requestSubmit());
    };

    await save("Codex", "/opt/codex/bin/codex");
    await save("OpenCode", "/opt/opencode/bin/opencode");
    expect(
      JSON.parse(
        localStorage.getItem("omnicode.providerBinaryPaths.v1") ?? "{}",
      ),
    ).toEqual({
      codex: "/opt/codex/bin/codex",
      opencode: "/opt/opencode/bin/opencode",
    });
    await act(async () => details.click());
    expect(document.body.textContent).toContain("/opt/codex/bin/codex");
    expect(document.body.textContent).toContain("codex-cli 0.156.1");
    expect(document.body.textContent).toContain("Restart required");
    await act(async () => details.click());
    const openCodeDetails = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Show OpenCode CLI details"]',
    )!;
    await act(async () => openCodeDetails.click());
    expect(document.body.textContent).toContain("/opt/opencode/bin/opencode");
    expect(document.body.textContent).toContain("opencode 1.18.32");
    await act(async () => openCodeDetails.click());

    await save("Codex", "/bad/codex");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Codex failed to start",
    );
    expect(container.textContent).not.toContain("/opt/codex/bin/codex");
    expect(
      JSON.parse(
        localStorage.getItem("omnicode.providerBinaryPaths.v1") ?? "{}",
      ).codex,
    ).toBe("/opt/codex/bin/codex");
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    expect(
      document.querySelector('[aria-label="Retry Codex configured path"]'),
    ).not.toBeNull();

    failAutoCodex = true;
    await save("Codex", "");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Codex auto-detection failed",
    );
    expect(
      JSON.parse(
        localStorage.getItem("omnicode.providerBinaryPaths.v1") ?? "{}",
      ).codex,
    ).toBe("/opt/codex/bin/codex");

    failAutoCodex = false;
    await save("Codex", "");
    expect(
      JSON.parse(
        localStorage.getItem("omnicode.providerBinaryPaths.v1") ?? "{}",
      ).codex,
    ).toBeUndefined();
    await act(async () => details.click());
    expect(document.body.textContent).toContain("/auto/codex");
    expect(document.body.textContent).toContain("Auto-detected");
  });

  it("offers manual auto-detect retry when a CLI is missing", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "harness_resolve_codex") {
        throw new Error("Codex CLI not found");
      }
      return undefined;
    });
    await render("providers");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show Codex CLI details"]',
        )!
        .click(),
    );
    const retry = document.querySelector<HTMLButtonElement>(
      '[aria-label="Retry Codex auto-detect"]',
    )!;
    expect(retry).not.toBeNull();
    await act(async () => retry.click());
    expect(invoke).toHaveBeenCalledWith("harness_resolve_codex", undefined);
  });

  it("reopens, scrolls to, focuses and highlights the same project on a repeated notification settings request", async () => {
    vi.useFakeTimers();
    const scroll = vi.spyOn(scrollWithinModule, "scrollWithin");
    rememberNotificationProjects([
      {
        id: "repository:github.com/work/app",
        name: "work/app",
        detail: "github.com",
        kind: "repository",
        paths: ["/repo"],
      },
    ]);
    const shortcut = {
      anchor: "project-notifications" as const,
      notificationProjectPath: "/repo",
      notificationSettingsRequest: 1,
    };
    await render("inbox", shortcut);
    const project = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notification categories for work/app"]',
    )!;
    const card = project.closest("fieldset")!;
    const section = container.querySelector(
      '[data-setting-id="project-notifications"]',
    )!;
    const highlight = () => section.querySelector(".border-accent\\/60");
    expect(highlight()).not.toBeNull();
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(card);

    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(highlight()).toBeNull();
    await act(async () => project.click());
    expect(project.getAttribute("aria-expanded")).toBe("false");
    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="Search settings"]',
    )!;
    search.focus();
    expect(document.activeElement).toBe(search);
    scroll.mockClear();

    await render("inbox", { ...shortcut, notificationSettingsRequest: 2 });

    expect.soft(project.getAttribute("aria-expanded")).toBe("true");
    expect.soft(scroll).toHaveBeenCalledWith(card);
    expect.soft(document.activeElement === card).toBe(true);
    expect.soft(highlight()).not.toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(highlight()).toBeNull();
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(card);
  });

  it("clears the project shortcut highlight after 1.8 seconds while keeping its project open and focused", async () => {
    vi.useFakeTimers();
    rememberNotificationProjects([
      {
        id: "repository:github.com/work/app",
        name: "work/app",
        detail: "github.com",
        kind: "repository",
        paths: ["/repo"],
      },
    ]);
    await render("inbox", {
      anchor: "project-notifications",
      notificationProjectPath: "/repo",
    });
    const section = container.querySelector(
      '[data-setting-id="project-notifications"]',
    )!;
    const project = section.querySelector(
      'button[aria-label="Notification categories for work/app"]',
    )!;
    expect(section.querySelector(".border-accent\\/60")).not.toBeNull();
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(project.closest("fieldset"));

    await act(async () => vi.advanceTimersByTimeAsync(1800));

    expect(section.querySelector(".border-accent\\/60")).toBeNull();
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(project.closest("fieldset"));
  });

  it("gives every section a rail group", () => {
    const groups = new Set(SETTINGS_SECTIONS.map((section) => section.group));
    expect([...groups]).toEqual(["app", "agents", "workspace"]);
  });

  it("indexes each setting once", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("lets files open as normal top-bar tabs", async () => {
    await render("general");
    const control = container.querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="File tabs"]',
    )!;
    const [besideChat, topBar] = Array.from(
      control.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );

    expect(besideChat?.getAttribute("aria-checked")).toBe("true");
    expect(topBar?.getAttribute("aria-checked")).toBe("false");

    await act(async () => topBar?.click());

    expect(topBar?.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("omnicode.fileTabMode")).toBe("workspace");
  });

  it("turns tab animations on by default and lets them be switched off", async () => {
    await render("general");
    const control = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Tab animations"]',
    )!;

    expect(control.getAttribute("aria-checked")).toBe("true");
    await act(async () => control.click());
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("omnicode.tabAnimationsEnabled")).toBe("0");
  });

  it("owns navigation inside the Settings view and changes pages in place", async () => {
    await render("general", { onSelectSection: undefined });
    const view = container.querySelector("[data-app-settings]")!;
    const navigation = view.querySelector('nav[aria-label="Settings"]')!;
    const appearance = Array.from(
      navigation.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Appearance")!;

    await act(async () => appearance.click());
    await act(async () => container.querySelectorAll('[data-settings-page][aria-hidden="true"]').forEach(completeMotionAnimation));

    expect(appearance.getAttribute("aria-current")).toBe("true");
    expect(view.querySelector('[data-setting-id="theme"]')).not.toBeNull();
    expect(view.querySelector('[data-setting-id="ui-language"]')).toBeNull();
    expect(navigation.textContent).not.toContain("Back");
  });

  it("removes the project rail layout setting and ignores its stored preference", async () => {
    localStorage.setItem("omnicode.collapsedProjectRailMode", "hidden");
    await render("appearance");
    expect(
      container.querySelector('[data-setting-id="collapsed-project-rail"]'),
    ).toBeNull();
    expect(
      SETTINGS_INDEX.some((row) => row.id === "collapsed-project-rail"),
    ).toBe(false);
  });

  it("sets interface scale from a menu instead of a live slider", async () => {
    await render("appearance");
    const row = container.querySelector('[data-setting-id="interface-scale"]')!;
    expect(row.querySelector('input[type="range"]')).toBeNull();
    const trigger = row.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    )!;
    expect(trigger.getAttribute("aria-label")).toBe("Interface scale: 100%");

    await act(async () => trigger.click());
    const option = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((node) => node.textContent?.includes("150%"));
    expect(option).toBeTruthy();
    await act(async () => option!.click());

    expect(localStorage.getItem("omnicode.uiScale")).toBe("1.5");
    expect(trigger.getAttribute("aria-label")).toBe("Interface scale: 150%");
    document.documentElement.style.removeProperty("zoom");
  });

  it("selects named desktop palettes and restores automatic color mode", async () => {
    localStorage.setItem("omnicode.desktopColorScheme", "system");
    localStorage.setItem("omnicode.mobile.skin", "linen");
    localStorage.setItem("omnicode.accentColor", "#8b5cf6");
    await render("appearance");
    const row = container.querySelector('[data-setting-id="desktop-skin"]')!;
    const selectSkin = async (label: string) => {
      const option = Array.from(row.querySelectorAll<HTMLLabelElement>('label'))
        .find((node) => node.textContent === label)?.querySelector<HTMLInputElement>('input[type="radio"]');
      expect(option).toBeTruthy();
      await act(async () => option!.click());
    };

    await selectSkin("Foundry");
    expect(localStorage.getItem("omnicode.desktopSkin")).toBe("foundry");
    expect(document.documentElement.dataset.skin).toBe("foundry");
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
    await selectSkin("Lagoon");
    expect(document.documentElement.dataset.skin).toBe("lagoon");
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
    expect(row.querySelector<HTMLInputElement>('input[value="lagoon"]')!.checked).toBe(true);

    await selectSkin("Automatic");
    expect(localStorage.getItem("omnicode.desktopSkin")).toBe("auto");
    expect(localStorage.getItem("omnicode.desktopColorScheme")).toBe("system");
    expect(document.documentElement.dataset.skin).toBe(
      window.matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : "midnight",
    );
    expect(localStorage.getItem("omnicode.mobile.skin")).toBe("linen");
    expect(localStorage.getItem("omnicode.accentColor")).toBe("#8b5cf6");

    await selectSkin("Dusk");
    const restore = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Restore defaults")!;
    await act(async () => restore.click());
    expect(localStorage.getItem("omnicode.desktopSkin")).toBe("auto");
    expect(document.documentElement.dataset.skin).toBe("midnight");
  });

  it("reports embedded navigation changes to its owner", async () => {
    await render("general");
    const keybindings = Array.from(
      container.querySelectorAll<HTMLButtonElement>("nav button"),
    ).find((button) => button.textContent === "Keybindings")!;

    await act(async () => keybindings.click());

    expect(onSelectSection).toHaveBeenCalledWith("keybindings");
    expect(
      container.querySelector('[aria-label="Change App: Search shortcut"]'),
    ).not.toBeNull();
  });

  // The search index is hand-maintained; this is what keeps it honest.
  it.each(
    [...new Set(SETTINGS_INDEX.map((entry) => entry.section))].map(
      (section) => ({ section }),
    ),
  )(
    "renders every indexed setting on the $section page",
    async ({ section }) => {
      await render(section);
      const expected = SETTINGS_INDEX.filter(
        (entry) => entry.section === section,
      ).map((entry) => entry.id);
      const rendered = new Set(renderedSettingIds());
      if (section === "connections") {
        for (const tab of container.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
          await act(async () => tab.click());
          for (const id of renderedSettingIds()) rendered.add(id);
        }
      }
      expect([...rendered].sort()).toEqual(expected.sort());
    },
  );

  it("shows path details for every Agent CLI", async () => {
    await render("providers");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "harness_exec"),
    ).toBe(false);
    for (const harness of HARNESSES) {
      expect(
        container.querySelector(
          `[aria-label="Show ${HARNESS_TITLE[harness]} CLI details"]`,
        ),
      ).not.toBeNull();
    }
  });

  it("returns focus to the CLI trigger when the details popover closes", async () => {
    await render("providers");
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show Codex CLI details"]',
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps location failures separate from CLI check failures", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "harness_resolve_codex") return { path: "/auto/codex" };
      if (command === "harness_exec") return "codex-cli 0.156.1";
      if (command === "reveal_path")
        throw new Error("File manager unavailable");
      return undefined;
    });
    await render("providers");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show Codex CLI details"]',
        )!
        .click(),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open Codex CLI location"]',
        )!
        .click(),
    );
    expect(document.body.textContent).toContain(
      "Could not open the CLI location: File manager unavailable",
    );
  });

  it("only tags rows that search can find", async () => {
    for (const section of SETTINGS_SECTIONS.map((item) => item.id)) {
      if (section === "skills") continue;
      await render(section);
      for (const id of renderedSettingIds()) {
        expect(
          SETTINGS_INDEX.some((entry) => entry.id === id),
          `${section}: ${id}`,
        ).toBe(true);
      }
    }
  });
});

describe("settings search", () => {
  async function type(value: string) {
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Search settings"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  function options(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .filter(option => !option.closest('[aria-hidden="true"]'));
  }

  it("finds a setting that lives on another page", async () => {
    await render("general");
    await type("prettier");
    expect(options().map((item) => item.textContent)).toEqual([
      "Format on saveChat",
    ]);

    await act(async () => options()[0]!.click());
    expect(onSelectSection).toHaveBeenCalledWith("chat");
  });

  it("finds and reveals project notifications separately from global notifications", async () => {
    await render("general");
    await type("project notifications");
    expect(options().map((item) => item.textContent)).toEqual([
      "Project notificationsInbox",
    ]);

    await act(async () => options()[0]!.click());
    expect(onSelectSection).toHaveBeenCalledWith("inbox");
    await render("inbox");
    const section = container.querySelector(
      '[data-setting-id="project-notifications"]',
    );
    expect(
      section?.querySelector('[aria-label="Project notifications"]'),
    ).not.toBeNull();
    expect(section?.querySelector(".border-accent\\/60")).not.toBeNull();
  });

  // A page whose name starts with the query beats a setting that merely
  // mentions it; anything weaker loses to the settings themselves.
  it("ranks a page against the settings that mention it", async () => {
    await render("general");
    await type("archive");
    expect(
      options().map((item) => item.querySelector("span")!.textContent),
    ).toEqual(["Archive", "Show archived in the sidebar"]);

    await type("notification");
    expect(
      options().map((item) => item.querySelector("span")!.textContent),
    ).toEqual([
      "Notifications",
      "Project notifications",
      "Claude Code hooks",
      "General",
      "Inbox",
    ]);
  });

  it("closes the results without touching the page when cleared", async () => {
    await render("general");
    const input = await type("sounds");
    expect(options().length).toBeGreaterThan(0);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Clear settings search"]',
        )!
        .click();
    });
    expect(options()).toHaveLength(0);
    expect(input.value).toBe("");
    expect(onSelectSection).not.toHaveBeenCalled();
  });

  it("records a custom keybinding from the key cell", async () => {
    await render("keybindings");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Change App: Search shortcut"]',
    )!;
    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyM",
          key: "m",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBe(
      '{"App: Search":{"shortcut":"Control+Shift+KeyM"}}',
    );
    expect(input.value).toBe("Ctrl+Shift+M");
  });

  it("stores a keybinding recorded in Chinese under the English command id", async () => {
    localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN");
    refreshUiLanguage();
    await render("keybindings");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="更改 应用：搜索 的快捷键"]',
    )!;
    expect(input).not.toBeNull();
    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyM",
          key: "m",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBe(
      '{"App: Search":{"shortcut":"Control+Shift+KeyM"}}',
    );
    expect(input.value).toBe("Ctrl+Shift+M");
  });

  it("lets Tab leave the recorder and keeps Cmd+Delete recordable", async () => {
    await render("keybindings");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Change App: Search shortcut"]',
    )!;

    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Tab",
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(container.textContent).not.toContain("Del disables");

    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Delete",
          key: "Delete",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBe(
      '{"App: Search":{"shortcut":"Command+Delete"}}',
    );
  });

  it("surfaces a storage failure instead of silently dropping the change", async () => {
    await render("keybindings");
    (
      localStorage as unknown as {
        setItem: (key: string, value: string) => void;
      }
    ).setItem = () => {
      throw new Error("quota exceeded");
    };
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Change App: Search shortcut"]',
    )!;
    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyY",
          key: "y",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(container.textContent).toContain("Could not save shortcuts");
  });

  it("records an Alt shortcut on a keybinding row", async () => {
    await render("keybindings");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Change App: Search shortcut"]',
    )!;
    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyM",
          key: "m",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBe(
      '{"App: Search":{"shortcut":"Option+KeyM"}}',
    );
    expect(input.value).toBe("Alt+M");
  });

  it("disables and restores an individual keybinding", async () => {
    await render("keybindings");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Change App: Search shortcut"]',
    )!;
    await act(async () => input.click());
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Backspace",
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBe(
      '{"App: Search":{"disabled":true}}',
    );
    expect(input.value).toBe("Disabled");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Reset App: Search shortcut"]',
        )!
        .click(),
    );
    expect(localStorage.getItem("omnicode.keybindingOverrides")).toBeNull();
  });

  it("reveals a setting on the current page", async () => {
    await render("general");
    await type("sounds");
    await act(async () => options()[0]!.click());
    expect(onSelectSection).not.toHaveBeenCalled();
    const row = container.querySelector('[data-setting-id="sounds"]')!;
    expect(row.className).toContain("bg-accent/10");
  });
});

describe("providers scope inheritance", () => {
  async function selectScope(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Provider defaults scope"]',
    )!;
    await act(async () => trigger.click());
    const option = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((node) => node.textContent?.trim() === label);
    expect(option).toBeTruthy();
    await act(async () => option!.click());
  }

  it("inherits the global default provider and picker visibility in project scope", async () => {
    localStorage.setItem(
      "omnicode.lastModel",
      JSON.stringify({ harness: "claude", model: "claude:opus-5" }),
    );
    localStorage.setItem(
      "omnicode.hiddenPickerProviders",
      JSON.stringify(["cursor"]),
    );
    await render("providers");

    await selectScope("repo");

    // A project with no overrides shows the inherited global default provider.
    const claudeRow = container
      .querySelector('[aria-label^="Claude Code model"]')!
      .closest(".settings-row")!;
    const claudeDefault = Array.from(
      claudeRow.querySelectorAll<HTMLButtonElement>("button"),
    ).find((node) => node.textContent?.trim() === "Default");
    expect(claudeDefault).toBeTruthy();

    // Picker visibility also inherits the global setting.
    expect(
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show Claude Code in the model picker"]',
        )!
        .getAttribute("aria-checked"),
    ).toBe("true");
    const cursorToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show Cursor in the model picker"]',
    )!;
    expect(cursorToggle.getAttribute("aria-checked")).toBe("false");
    // Global precedence: the project toggle cannot turn a globally hidden
    // provider back on, so it is locked and explained.
    expect(cursorToggle.hasAttribute("disabled")).toBe(true);
    expect(cursorToggle.closest(".settings-row")?.textContent).toContain(
      "Hidden globally",
    );
  });
});

it("saves a shared account through Host, prevents removing it and supports retry", async () => {
  let failSave = true;
  mockAccountHost({ setDefault: () => { if (failSave) throw new Error("Unable to save fixture default"); } });
  saveProviderAccount({ provider: "codex", id: "work", label: "9300" });
  await render("providers");
  const choose = () => accountMenuItem("9300", "Use as shared default");
  const first = (await choose())!;
  expect(first.disabled).toBe(false);
  await act(async () => first.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to save fixture default");
  failSave = false;
  const retry = (await choose())!;
  expect(retry).not.toBeUndefined();
  await act(async () => retry.click());
  // Once it is the default, the menu offers only removal, and that is locked.
  const remove = (await accountMenuItem("9300", "Remove account"))!;
  expect(remove.disabled).toBe(true);
  expect(
    [...document.body.querySelectorAll('[role="menuitem"]')].some((item) =>
      item.textContent?.includes("Use as shared default"),
    ),
  ).toBe(false);
  expect(invoke).toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.setDefault", params: expect.objectContaining({ provider: "codex", accountId: "work" }) }));
  expect(invoke).not.toHaveBeenCalledWith("provider_accounts_publish", expect.anything());
});

it.each([
  { provider: "claude", action: "add" },
  { provider: "codex", action: "add" },
  { provider: "claude", action: "edit" },
  { provider: "codex", action: "edit" },
  { provider: "codex", action: "import" },
] as const)(
  "toggles the $provider $action editor without discarding its draft",
  async ({ provider, action }) => {
    await render("providers");
    const trigger =
      action === "add"
        ? [
            ...container.querySelectorAll<HTMLButtonElement>(
              'button[type="button"]',
            ),
          ].filter((button) => button.textContent === "Add account")[
            provider === "claude" ? 0 : 1
          ]
        : action === "edit"
          ? container.querySelectorAll<HTMLButtonElement>(
              '[aria-label="Rename Default account"]',
            )[provider === "claude" ? 0 : 1]
          : [...container.querySelectorAll<HTMLButtonElement>("button")].find(
              (button) => button.textContent === "Import current Codex login",
            )!;
    const selector = `[aria-label="${action === "edit" ? "Rename" : "New"} ${HARNESS_TITLE[provider]} account"]`;
    const press = async () => {
      await act(async () =>
        trigger.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        ),
      );
      await act(async () => trigger.click());
    };
    await press();
    const input = container.querySelector<HTMLInputElement>(selector)!;
    const original = input.value;
    const home = container.querySelector<HTMLInputElement>(
      `[aria-label="${HARNESS_TITLE[provider]} Data Home"]`,
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "Unsaved name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (home) {
        setter.call(home, "/unsaved/home");
        home.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await press();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const fold = input.closest<HTMLElement>(".zen-fold-item")!;
    expect(fold.inert).toBe(true);
    expect(fold.getAttribute("aria-hidden")).toBe("true");
    // Reversing before the animation ends keeps the same input and its value.
    await press();
    expect(container.querySelector(selector)).toBe(input);
    expect(input.value).toBe("Unsaved name");
    await press();
    await act(async () =>
      completeMotionAnimation(fold),
    );
    expect(container.querySelector(selector)).toBeNull();
    await press();
    const reopened = container.querySelector<HTMLInputElement>(selector)!;
    expect(reopened.value).toBe("Unsaved name");
    if (home)
      expect(
        container.querySelector<HTMLInputElement>(
          `[aria-label="${HARNESS_TITLE[provider]} Data Home"]`,
        )!.value,
      ).toBe("/unsaved/home");
    await act(async () =>
      [
        ...reopened
          .closest("form")!
          .querySelectorAll<HTMLButtonElement>("button"),
      ]
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    await act(async () =>
      completeMotionAnimation(reopened.closest(".zen-fold-item")),
    );
    await press();
    expect(container.querySelector<HTMLInputElement>(selector)!.value).toBe(
      original,
    );
  },
);

it("switches between adding and importing a Codex account without closing the new editor", async () => {
  await render("providers");
  const add = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
  ].filter((button) => button.textContent === "Add account")[1];
  const importing = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Import current Codex login")!;
  await act(async () => add.click());
  expect(add.getAttribute("aria-expanded")).toBe("true");
  await act(async () => importing.click());
  expect(importing.getAttribute("aria-expanded")).toBe("true");
  expect(add.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[aria-label="Codex Data Home"]')).toBeNull();
  await act(async () => add.click());
  expect(add.getAttribute("aria-expanded")).toBe("true");
  expect(importing.getAttribute("aria-expanded")).toBe("false");
  expect(
    container.querySelector('[aria-label="Codex Data Home"]'),
  ).not.toBeNull();
});

it("imports the current Codex login into a named profile and animates the editor closed", async () => {
  const copied = vi.fn();
  mockAccountHost({ imported: copied });
  await render("providers");
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Import current Codex login")!.click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="New Codex account"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "9300");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(copied).toHaveBeenCalledOnce();
  expect(providerAccounts("codex").some(account => account.label === "9300")).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith("remote_request", expect.objectContaining({ method: "providerAccounts.setDefault" }));
  const closing = container.querySelector('[data-fold-state="closing"]');
  expect(closing?.getAttribute("aria-hidden")).toBe("true");
  expect(closing?.hasAttribute("inert")).toBe(true);
  await act(async () => completeMotionAnimation(closing));
  expect(container.querySelector('[aria-label="New Codex account"]')).toBeNull();
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
