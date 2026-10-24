import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import { configureSharedHost } from "../../connections/model/remoteProjects";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { SettingsView, preloadSettingsSection } from "../../../app/ui/SettingsView";
import * as scrollWithinModule from "../../../shared/lib/scrollWithin";
import { loginHarness } from "../../providers/model/providerLogin";
import * as harnessRegistry from "../../providers/model/hostModelCatalog";
import { defaultSessionChoice, loadDefaultModels, loadUseLastSelection, saveLastModelChoice, saveLastSelectedModel } from "../../sessions/model/models";
import { resetHarnessModelOverlays, setHarnessModels } from "../../../integrations/harness/core/modelCatalog";
import { AppViewDialog } from "../../../shared/ui/messaging/AppViewDialog";
import { refreshUiLanguage, UI_LANGUAGE_KEY } from "../../../shared/i18n/language";
import { rememberNotificationProjects } from "../../notifications/model/notificationProjects";
import { SETTINGS_INDEX, SETTINGS_SECTIONS, type SettingsSectionId } from "../model/settings";
import { providerAccounts, saveProviderAccount } from "../../providers/model/providerAccounts";
import { clearCachedRateLimits, setCachedRateLimits } from "../../providers/model/rateLimitsCache";
import { HARNESSES, type HarnessId } from "../../../contracts/session";
import { HARNESS_TITLE } from "../../../contracts/session";
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
vi.mock("../../providers/model/providerLogin", () => ({ loginHarness: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../providers/model/harnessAvailability", () => ({
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

beforeAll(async () => {
  await Promise.all(SETTINGS_SECTIONS.map(({ id }) => preloadSettingsSection(id)));
});

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

/** Shows one provider's detail from the Providers list. */
async function selectProvider(harness: HarnessId) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-ui="provider-list"] [data-provider="${harness}"]`,
      )!
      .click(),
  );
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
        .spyOn(harnessRegistry, "refreshHostModelCatalogs")
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
        await selectProvider(harness);
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
    expect(emails).toHaveLength(1);
    expect(emails[0].querySelector("span")?.className).toContain("blur-[5px]");
    expect(container.textContent).toContain("Pro");
    await act(async () => emails[0].click());
    expect(emails[0].getAttribute("aria-label")).toBe("Hide email");
    expect(emails[0].querySelector("span")?.className).not.toContain("blur");
    await act(async () => emails[0].click());
    expect(emails[0].getAttribute("aria-label")).toBe("Reveal email");

    await act(async () => emails[0].click());
    // Another provider's accounts stay masked.
    await selectProvider("codex");
    expect(container.querySelector('[aria-label="Hide email"]')).toBeNull();
    expect(container.textContent).toContain("codex@example.com");
    await selectProvider("claude");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Reveal email"]')!.click(),
    );
    await render("general");
    await render("providers");
    expect(container.querySelector('[aria-label="Hide email"]')).toBeNull();
    expect(
      container.querySelectorAll('[aria-label="Reveal email"]'),
    ).toHaveLength(1);
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
    expect(identity("claude", "operator").textContent).toContain("Claude operator");
    await selectProvider("codex");
    expect(identity("codex", "work").textContent).toContain("work@example.com");
    expect(identity("codex", "personal").textContent).toContain("personal@example.com");
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
    await selectProvider(provider);
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

  it("shows one background strength for new and existing conversations", async () => {
    localStorage.setItem(
      "omnicode.chatBackgroundPath",
      "/app-data/backgrounds/chat-background.png",
    );
    localStorage.setItem("omnicode.chatBackgroundEmptyOpacity", "1");
    localStorage.setItem("omnicode.chatBackgroundSessionOpacity", "0.35");
    await render("appearance");

    const effect = container.querySelector(
      "#new-thread-background-effect-dither",
    )!;
    const effectRow = effect.closest(".settings-row")!;
    const strengthRow = container
      .querySelector('[aria-label="Background image strength"]')!
      .closest(".settings-row")!;
    expect(effect).not.toBeNull();
    expect(
      effectRow.compareDocumentPosition(strengthRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(container.querySelectorAll('[aria-label="Background image strength"]')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Show background on"]')).toBeNull();
    expect(container.querySelector('[aria-label="Empty chat background visibility"]')).toBeNull();
    expect(container.querySelector('[aria-label="Session background visibility"]')).toBeNull();
    const strength = strengthRow.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(strength.value).toBe("35");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(strength, "60");
      strength.dispatchEvent(new Event("input", { bubbles: true }));
      strength.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.documentElement.style.getPropertyValue("--chat-background-opacity")).toBe("0.6");
    expect(localStorage.getItem("omnicode.chatBackgroundOpacity")).toBe("0.6");
    expect(localStorage.getItem("omnicode.chatBackgroundEmptyOpacity")).toBeNull();
    expect(localStorage.getItem("omnicode.chatBackgroundSessionOpacity")).toBeNull();

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
    await selectProvider("codex");

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
    await selectProvider("codex");
    expect(container.textContent).toContain("Disk account");
    expect(container.textContent).not.toContain("/data/existing");
    expect(container.textContent).toContain("Data Home is managed by Host");
    await selectProvider(provider);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent === "Add account");
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
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
    await selectProvider("codex");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open Codex CLI location"]',
        )!
        .click(),
    );
    expect(invoke).toHaveBeenCalledWith("reveal_path", {
      path: "/auto/codex",
    });

    const save = async (provider: "Codex" | "OpenCode", path: string) => {
      await selectProvider(provider.toLowerCase() as HarnessId);
      const edit = container.querySelector<HTMLButtonElement>(
        `[aria-label="Edit ${provider} CLI path"]`,
      )!;
      if (edit.getAttribute("aria-expanded") !== "true") {
        await act(async () => edit.click());
      }
      const input = container.querySelector<HTMLInputElement>(
        `#${provider.toLowerCase()}-binary-path`,
      )!;
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
    expect(container.textContent).toContain("/opt/opencode/bin/opencode");
    expect(container.textContent).toContain("opencode 1.18.32");
    await selectProvider("codex");
    expect(container.textContent).toContain("/opt/codex/bin/codex");
    expect(container.textContent).toContain("codex-cli 0.156.1");
    expect(container.textContent).toContain("Restart required");

    await save("Codex", "/bad/codex");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Codex failed to start",
    );
    expect(container.textContent).not.toContain("/opt/codex/bin/codex");
    expect(
      JSON.parse(
        localStorage.getItem("omnicode.providerBinaryPaths.v1") ?? "{}",
      ).codex,
    ).toBe("/opt/codex/bin/codex");
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("#codex-binary-editor button"))
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    expect(
      container.querySelector('[aria-label="Retry Codex configured path"]'),
    ).not.toBeNull();

    failAutoCodex = true;
    await save("Codex", "");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
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
    expect(container.textContent).toContain("/auto/codex");
    expect(container.textContent).toContain("Auto-detected");
  });

  it("offers manual auto-detect retry when a CLI is missing", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "harness_resolve_codex") {
        throw new Error("Codex CLI not found");
      }
      return undefined;
    });
    await render("providers");
    await selectProvider("codex");
    // A CLI that was never installed is not an error.
    expect(
      [...container.querySelectorAll('[role="alert"]')].some((alert) =>
        alert.textContent?.includes("Codex CLI not found"),
      ),
    ).toBe(false);
    expect(container.textContent).toContain("Not found on this computer");
    vi.mocked(invoke).mockClear();
    const retry = container.querySelector<HTMLButtonElement>(
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

  it("restores appearance defaults after reversing navigation before the old page exits", async () => {
    localStorage.setItem("omnicode.desktopSkin", "dusk");
    await render("appearance");
    const navigate = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((button) => button.textContent === label)!.click();
    await act(async () => navigate("General"));
    await act(async () => navigate("Appearance"));
    await act(async () => container.querySelectorAll('[data-settings-page][aria-hidden="true"]')
      .forEach(completeMotionAnimation));
    const restore = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Restore defaults")!;
    await act(async () => restore.click());
    expect(localStorage.getItem("omnicode.desktopSkin")).toBe("auto");
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

  it("installs missing CLIs from an inline step, preserves busy state across navigation and offers retry", async () => {
    const original = vi.mocked(invoke).getMockImplementation()!;
    let fail!: (error: Error) => void;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "harness_install") {
        return new Promise((_, reject) => { fail = reject; });
      }
      if (command === "harness_cli_plan") {
        return Promise.resolve({
          installCommand: "npm install -g @openai/codex", path: null,
          removes: [], uninstallCommand: null, uninstallBlocker: null,
        });
      }
      return original(command, args);
    });
    await render("providers");
    await selectProvider("codex");
    const download = () => container.querySelector<HTMLButtonElement>('[aria-label="Download and install Codex"]')!;
    const action = () => [...container.querySelectorAll<HTMLButtonElement>("#codex-cli-panel button")].at(-1)!;
    expect(download().textContent).toBe("Install");
    expect(download().title).toBe("Download and install this CLI on this computer");
    expect(container.querySelector('[aria-label="Download and install Claude Code"]')).toBeNull();
    expect(download().getAttribute("aria-expanded")).toBe("false");
    await act(async () => download().click());
    expect(download().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#codex-cli-panel")?.textContent).toContain("npm install -g @openai/codex");
    expect(action().textContent).toBe("Install");
    await act(async () => action().click());
    expect(action().disabled).toBe(true);
    expect(action().getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toContain("Downloading and installing CLI");
    await render("general");
    await render("providers");
    // The list keeps showing the work while another provider is open.
    expect(container.querySelector('[data-provider="codex"] [aria-label="Working…"]')).not.toBeNull();
    await selectProvider("codex");
    expect(download().getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toContain("Downloading and installing CLI");
    await act(async () => fail(new Error("Download interrupted")));
    expect(download().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('#codex-cli-panel [role="alert"]')?.textContent).toContain("Download interrupted");
    expect(action().textContent).toBe("Retry");
    expect(action().disabled).toBe(false);
    await act(async () => action().click());
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "harness_install")).toHaveLength(2);
    await act(async () => fail(new Error("Still offline")));
  });

  it("removes an installed CLI only after reviewing what will be deleted", async () => {
    const original = vi.mocked(invoke).getMockImplementation()!;
    let blocker: string | null = null;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "harness_cli_plan") {
        return Promise.resolve({
          installCommand: null, path: "/home/me/.local/bin/claude",
          removes: blocker ? [] : ["/home/me/.local/bin/claude", "/home/me/.local/share/claude"],
          uninstallCommand: null, uninstallBlocker: blocker,
        });
      }
      if (command === "harness_uninstall") return Promise.resolve();
      return original(command, args);
    });
    await render("providers");
    const remove = () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Claude Code CLI"]')!;
    const panel = () => container.querySelector("#claude-cli-panel")!;
    expect(container.querySelector('[aria-label="Remove Codex CLI"]')).toBeNull();
    await act(async () => remove().click());
    expect(panel().textContent).toContain("/home/me/.local/share/claude");
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "harness_uninstall")).toBe(false);
    const confirm = [...panel().querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove CLI")!;
    await act(async () => confirm.click());
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("harness_uninstall", { provider: "claude", binaryPath: null });

    blocker = "This CLI was installed with Homebrew. Remove it with brew uninstall.";
    await act(async () => remove().click());
    expect(remove().getAttribute("aria-expanded")).toBe("false");
    await act(async () => remove().click());
    expect(panel().textContent).toContain("Homebrew");
    expect([...panel().querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Remove CLI");
  });

  it("lists every Agent CLI and shows its path only in its own detail", async () => {
    await render("providers");
    // Only the open provider's CLI is checked, not every CLI at once.
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "harness_exec")
        .length,
    ).toBeLessThanOrEqual(1);
    for (const harness of HARNESSES) {
      await selectProvider(harness);
      expect(
        container
          .querySelector(`[data-provider="${harness}"]`)
          ?.getAttribute("aria-current"),
      ).toBe("true");
      expect(
        container.querySelector(
          `[aria-label="Edit ${HARNESS_TITLE[harness]} CLI path"]`,
        ),
      ).not.toBeNull();
    }
  });

  it("returns focus to Edit path when the path editor closes", async () => {
    await render("providers");
    await selectProvider("codex");
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit Codex CLI path"]',
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const input = container.querySelector<HTMLInputElement>("#codex-binary-path")!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
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
    await selectProvider("codex");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open Codex CLI location"]',
        )!
        .click(),
    );
    expect(container.textContent).toContain(
      "Could not open the CLI location: File manager unavailable",
    );
    expect(container.textContent).not.toContain("Needs attention");
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

  it("places Last selection second in the scope menu and persists it without changing fixed defaults", async () => {
    saveLastModelChoice("claude", "claude:opus-5");
    saveLastSelectedModel("cursor", "cursor:grok-4.6");
    await render("providers");
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="Provider defaults scope"]')!;
    await act(async () => trigger.click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .filter((node) => !node.closest("[inert]"));
    expect(options.map((node) => node.textContent?.trim())).toEqual(["Global", "Last selection", "repo"]);
    await act(async () => options[1].click());
    expect(loadUseLastSelection()).toBe(true);
    expect(container.querySelector('[aria-label="Provider defaults scope: Last selection"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Default provider: Cursor"]')?.disabled).toBe(true);
    expect(defaultSessionChoice()).toEqual({ harness: "cursor", model: "cursor:grok-4.6" });
    expect(loadDefaultModels().claude).toBe("claude:opus-5");

    await selectScope("repo");
    expect(loadUseLastSelection()).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Default provider: Cursor"]')?.disabled).toBe(false);
    expect(container.querySelector('[data-provider="cursor"]')?.textContent).toContain("Default");
    act(() => root.unmount());
    root = createRoot(container);
    await render("providers");
    expect(container.querySelector('[aria-label="Provider defaults scope: Last selection"]')).not.toBeNull();
    await selectScope("Global");
    expect(loadUseLastSelection()).toBe(false);
    expect(defaultSessionChoice()).toEqual({ harness: "claude", model: "claude:opus-5" });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Default provider: Claude Code"]')?.disabled).toBe(false);
  });

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
    expect(
      container.querySelector('[aria-label="Default provider: Claude Code"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-provider="claude"]')?.textContent,
    ).toContain("Default");

    // Picker visibility also inherits the global setting.
    expect(
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show Claude Code in the model picker"]',
        )!
        .getAttribute("aria-checked"),
    ).toBe("true");
    await selectProvider("cursor");
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
  await selectProvider("codex");
  const choose = () => accountMenuItem("9300", "Use as shared default");
  const first = (await choose())!;
  expect(first.disabled).toBe(false);
  await act(async () => first.click());
  expect(container.querySelector('[data-ui="provider-accounts"] [role="alert"]')?.textContent).toContain("Unable to save fixture default");
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
    await selectProvider(provider);
    const trigger =
      action === "add"
        ? [
            ...container.querySelectorAll<HTMLButtonElement>(
              'button[type="button"]',
            ),
          ].find((button) => button.textContent === "Add account")!
        : action === "edit"
          ? container.querySelector<HTMLButtonElement>(
              '[aria-label="Rename Default account"]',
            )!
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
  await selectProvider("codex");
  const add = [
    ...container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
  ].find((button) => button.textContent === "Add account")!;
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
  await selectProvider("codex");
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
