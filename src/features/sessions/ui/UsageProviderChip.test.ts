import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderRateLimits } from "../../../contracts/session";
import { projectKey } from "../../../shared/lib/paths";
import { saveTabGroupMascot } from "../../workspace/model/tabGroups";
import { needsProviderLogin, UsageProviderChip } from "./UsageProviderChip";
import { saveMaskEmails, saveShowRemainingUsage } from "../../settings/model/displayPrefs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));
const hostIdentity = vi.hoisted(() => ({ machine: undefined as string | undefined, accounts: {} as unknown }));
vi.mock("../../connections/model/remoteProjects", async (original) => ({
  ...(await original<object>()),
  sharedHostMachineId: () => hostIdentity.machine,
}));
vi.mock("../../connections/model/connections", async (original) => ({
  ...(await original<object>()),
  remoteRequest: vi.fn(async (_machine: string, method: string) => method === "providerAccounts.list" ? hostIdentity.accounts : null),
}));

const now = Date.parse("2026-09-16T12:00:00Z");

function codexLimits(): ProviderRateLimits {
  return {
    provider: "codex",
    session: {
      usedPercent: 42,
      windowMinutes: 300,
      resetsAt: now + 2 * 3_600_000,
    },
    weekly: {
      usedPercent: 81,
      windowMinutes: 10_080,
      resetsAt: now + 2 * 86_400_000 + 23 * 3_600_000,
    },
    monthly: null,
    resetCredits: {
      availableCount: 2,
      credits: [
        {
          id: "reset-1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: now - 86_400_000,
          expiresAt: now + 12 * 86_400_000,
          title: "Referral reward",
          description: "One Codex rate-limit reset",
        },
        {
          id: "reset-2",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: now - 43_200_000,
          expiresAt: now + 18 * 86_400_000,
          title: "Backup reset",
          description: "A second Codex rate-limit reset",
        },
      ],
    },
    updatedAt: now,
    error: null,
    status: "ok",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  hostIdentity.machine = undefined;
  hostIdentity.accounts = {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => !item.closest("[inert]") && (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

describe("UsageProviderChip", () => {
  it("reverses closing on the same account popup without restarting or duplicating it", async () => {
    await act(async () => root.render(createElement(UsageProviderChip, { limits: codexLimits(), now })));
    const trigger = button("Codex usage details");
    await act(async () => trigger.click());
    await act(async () => completeMotionAnimation(document.body));
    const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => trigger.click());
    expect(popup.inert).toBe(true);
    await act(async () => trigger.click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBe(popup);
    expect(popup.inert).toBe(false);
    await act(async () => completeMotionAnimation(document.body));
    expect(document.querySelector('[role="dialog"]')).toBe(popup);
    await act(async () => trigger.click());
    await act(async () => completeMotionAnimation(document.body));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("offers the provider-owned login flow for an expired Claude session", async () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: now,
      error: "Claude sign-in expired",
      status: "error",
    };
    const onReconnect = vi.fn(async () => undefined);
    act(() =>
      root.render(
        createElement(UsageProviderChip, { limits, now, onReconnect }),
      ),
    );

    await act(async () => button("Claude Code usage details").click());
    expect(document.querySelector(".size-9")).not.toBeNull();
    await act(async () => button("Sign in to Claude Code").click());

    expect(onReconnect).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Signed in to Claude Code");
  });

  it("does not describe account-specific usage restrictions as login failures", () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: now,
      error: "Claude usage is unavailable for this account",
      status: "error",
    };
    expect(needsProviderLogin(limits)).toBe(false);
  });

  it.each([
    "Usage is unavailable for environment-based authentication.",
    "No Codex usage data",
    "This Host does not support account usage yet. Update and restart it, then refresh.",
  ])("does not label unavailable usage as disconnected: %s", async (error) => {
    const limits = { ...codexLimits(), status: "unavailable" as const, session: null, weekly: null, resetCredits: null, error };
    const onReconnect = vi.fn();
    expect(needsProviderLogin(limits)).toBe(false);
    await act(async () => root.render(createElement(UsageProviderChip, { limits, now, onReconnect })));
    expect(button("Codex usage details").textContent).toContain("Usage unavailable");
    expect(button("Codex usage details").textContent).not.toContain("not connected");
    await act(async () => button("Codex usage details").click());
    expect(document.body.textContent).toContain(error);
    expect([...document.querySelectorAll("button")].some(button => button.textContent?.includes("Sign in to Codex"))).toBe(false);
  });

  it("opens a column of detailed progress bars", async () => {
    saveShowRemainingUsage(true);
    act(() =>
      root.render(
        createElement(UsageProviderChip, { limits: codexLimits(), now }),
      ),
    );

    const trigger = button("Codex usage details");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("5h58% leftWeek19% left");
    expect(trigger.title).toBe(
      "58% remaining · Resets in 2h · 19% remaining · Resets in 2d 23h",
    );
    expect(trigger.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    const sessionSummary = trigger.querySelector('[data-window="session"] [role="progressbar"]')!;
    const weeklySummary = trigger.querySelector('[data-window="weekly"] [role="progressbar"]')!;
    expect(sessionSummary.getAttribute("aria-valuenow")).toBe("58");
    expect(sessionSummary.previousElementSibling?.textContent).toBe("5h");
    expect(sessionSummary.nextElementSibling?.textContent).toBe("58% left");
    expect(sessionSummary.querySelector("span")?.getAttribute("style")).toBe("width: 58%;");
    expect(weeklySummary.getAttribute("aria-valuenow")).toBe("19");
    expect(weeklySummary.previousElementSibling?.textContent).toBe("Week");
    expect(weeklySummary.nextElementSibling?.textContent).toBe("19% left");
    expect(weeklySummary.querySelector("span")?.getAttribute("style")).toBe(
      "width: 19%;",
    );
    await act(async () => trigger.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(dialog?.textContent).toContain("5-hour limit");
    expect(dialog?.textContent).toContain("Weekly limit");
    expect(dialog?.textContent).toContain("58% remaining");
    expect(dialog?.textContent).toContain("19% remaining");
    // Each limit is one row: title, reset countdown, then the percentage.
    expect(
      dialog?.querySelector("section")?.querySelector("h3")?.parentElement
        ?.textContent,
    ).toBe("5-hour limitResets in 2h58% remaining");
    expect(dialog?.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    const sessionBar = dialog?.querySelector(
      '[aria-label="5-hour limit remaining"]',
    );
    const weeklyBar = dialog?.querySelector(
      '[aria-label="Weekly limit remaining"]',
    );
    expect(sessionBar?.getAttribute("aria-valuenow")).toBe("58");
    expect(sessionBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 58%;",
    );
    expect(weeklyBar?.getAttribute("aria-valuenow")).toBe("19");
    expect(weeklyBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 19%;",
    );
  });

  it("keeps the card on remaining capacity while details follow the used capacity preference", async () => {
    act(() =>
      root.render(
        createElement(UsageProviderChip, { limits: codexLimits(), now }),
      ),
    );

    const trigger = button("Codex usage details");
    expect(trigger.textContent).toBe("5h58% leftWeek19% left");
    expect(trigger.title).toBe(
      "58% remaining · Resets in 2h · 19% remaining · Resets in 2d 23h",
    );
    expect(trigger.querySelector('[data-window="weekly"] [role="progressbar"] > span')?.getAttribute("style")).toBe(
      "width: 19%;",
    );
    await act(async () => trigger.click());

    const weeklyBar = document.querySelector(
      '[role="dialog"] [aria-label="Weekly limit used"]',
    );
    expect(weeklyBar?.getAttribute("aria-valuenow")).toBe("81");
    expect(weeklyBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 81%;",
    );
  });

  it.each(["this window", "another window"])(
    "keeps card summaries on remaining while updating the open popover's preference in %s",
    async (source) => {
      act(() =>
        root.render(
          createElement(UsageProviderChip, { limits: codexLimits(), now }),
        ),
      );
      const trigger = button("Codex usage details");
      await act(async () => trigger.click());
      const changePreference = async (remaining: boolean) => {
        await act(async () => {
          if (source === "this window") {
            saveShowRemainingUsage(remaining);
          } else {
            localStorage.setItem(
              "omnicode.showRemainingUsage",
              remaining ? "1" : "0",
            );
            window.dispatchEvent(
              new StorageEvent("storage", {
                key: "omnicode.showRemainingUsage",
              }),
            );
          }
        });
      };

      await changePreference(true);
      expect(trigger.textContent).toBe("5h58% leftWeek19% left");
      expect(trigger.title).toContain("19% remaining");
      expect(trigger.querySelector('[data-window="weekly"] [role="progressbar"] > span')?.getAttribute("style")).toBe(
        "width: 19%;",
      );
      const remainingBar = document.querySelector(
        '[aria-label="Weekly limit remaining"]',
      );
      expect(remainingBar?.getAttribute("aria-valuenow")).toBe("19");
      expect(remainingBar?.previousElementSibling?.textContent).toBe(
        "Weekly limitResets in 2d 23h19% remaining",
      );

      await changePreference(false);
      expect(trigger.textContent).toBe("5h58% leftWeek19% left");
      expect(trigger.title).toContain("19% remaining");
      expect(trigger.querySelector('[data-window="weekly"] [role="progressbar"] > span')?.getAttribute("style")).toBe(
        "width: 19%;",
      );
      const usedBar = document.querySelector(
        '[aria-label="Weekly limit used"]',
      );
      expect(usedBar?.getAttribute("aria-valuenow")).toBe("81");
      expect(usedBar?.previousElementSibling?.textContent).toBe(
        "Weekly limitResets in 2d 23h81% used",
      );
    },
  );

  it("shows a full bar before usage and an empty bar when exhausted", async () => {
    saveShowRemainingUsage(true);
    const limits = codexLimits();
    limits.session!.usedPercent = 0;
    limits.weekly!.usedPercent = 100;
    act(() => root.render(createElement(UsageProviderChip, { limits, now })));

    expect(
      button("Codex usage details")
        .querySelector('[data-window="weekly"] [role="progressbar"] > span')
        ?.getAttribute("style"),
    ).toBe("width: 0%;");
    await act(async () => button("Codex usage details").click());

    const dialog = document.querySelector('[role="dialog"]');
    const sessionBar = dialog?.querySelector(
      '[aria-label="5-hour limit remaining"]',
    );
    const weeklyBar = dialog?.querySelector(
      '[aria-label="Weekly limit remaining"]',
    );
    expect(sessionBar?.getAttribute("aria-valuenow")).toBe("100");
    expect(sessionBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 100%;",
    );
    expect(weeklyBar?.getAttribute("aria-valuenow")).toBe("0");
    expect(weeklyBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 0%;",
    );
  });

  it("switches between named accounts from the usage popover", async () => {
    saveShowRemainingUsage(true);
    const onSelectAccount = vi.fn();
    act(() =>
      root.render(
        createElement(UsageProviderChip, {
          limits: codexLimits(),
          now,
          accountId: "default",
          accounts: [
            {
              id: "default",
              provider: "codex",
              label: "Default account",
              isDefault: true,
            },
            { id: "account-work", provider: "codex", label: "Work" },
          ],
          onSelectAccount,
          onAddAccount: vi.fn(),
        }),
      ),
    );

    await act(async () => button("Codex usage details").click());
    await act(async () => button("Switch Codex account").click());
    expect(document.body.textContent).toContain("Codex accounts");
    expect(document.body.textContent).toContain("Default account");
    const accountRow = button("Default account").parentElement!;
    const accountBar = accountRow.querySelector(
      '[aria-label="5h limit remaining"]',
    );
    expect(accountRow.textContent).toContain("58% left");
    expect(accountBar?.getAttribute("aria-valuenow")).toBe("58");
    expect(accountBar?.querySelector("span")?.getAttribute("style")).toBe(
      "width: 58%;",
    );
    await act(async () => button("Work").click());

    expect(onSelectAccount).toHaveBeenCalledWith("account-work");
    await act(async () => completeMotionAnimation(document.body));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("applies email masking live, reveals independently of account switching and hides on reopening", async () => {
    saveMaskEmails(false);
    hostIdentity.machine = "host";
    hostIdentity.accounts = { codex: [{ id: "default", label: "Main", identity: { email: "user@example.com", plan: "Pro" } }] };
    const onSelectAccount = vi.fn();
    await act(async () =>
      root.render(
        createElement(UsageProviderChip, {
          limits: codexLimits(),
          now,
          accountId: "default",
          accounts: [
            {
              id: "default",
              provider: "codex",
              label: "Main",
              isDefault: true,
            },
          ],
          onSelectAccount,
          onAddAccount: vi.fn(),
        }),
      ),
    );
    await act(async () => button("Codex usage details").click());

    expect(document.querySelector('[aria-label="Reveal email"]')).toBeNull();
    expect(document.querySelector('[title="user@example.com"]')).not.toBeNull();
    await act(async () => saveMaskEmails(true));

    const email = button("Reveal email");
    expect(email.querySelector("span")?.className).toContain("blur-[5px]");
    expect(email.querySelector("span")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(document.body.textContent).toContain("Pro");
    await act(async () => email.click());
    expect(button("Hide email").querySelector("span")?.className).not.toContain(
      "blur",
    );
    expect(document.body.textContent).toContain("Codex usage");
    expect(document.body.textContent).not.toContain("Codex accounts");
    expect(onSelectAccount).not.toHaveBeenCalled();
    await act(async () => button("Hide email").click());
    expect(button("Reveal email").getAttribute("aria-pressed")).toBe("false");

    await act(async () => button("Reveal email").click());
    await act(async () => button("Codex usage details").click());
    await act(async () => button("Codex usage details").click());
    expect(button("Reveal email").getAttribute("aria-pressed")).toBe("false");

    await act(async () => button("Switch Codex account").click());
    expect(button("Reveal email").querySelector("span")?.className).toContain(
      "blur-[5px]",
    );
    expect(document.querySelector("button button")).toBeNull();
    expect(
      [...document.querySelectorAll("[title], [aria-label]")].some((element) =>
        [
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
        ].some((label) => label?.includes("user@example.com")),
      ),
    ).toBe(false);
    await act(async () => button("Reveal email").click());
    expect(onSelectAccount).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Codex accounts");
    await act(async () => button("Main").click());
    expect(onSelectAccount).toHaveBeenCalledWith("default");
  });

  it("keeps account switching available when the pinned account was removed", async () => {
    act(() =>
      root.render(
        createElement(UsageProviderChip, {
          limits: codexLimits(),
          now,
          accountId: "account-missing",
          accounts: [
            {
              id: "default",
              provider: "codex",
              label: "Default account",
              isDefault: true,
            },
            { id: "account-work", provider: "codex", label: "Work" },
          ],
          onSelectAccount: vi.fn(),
          onAddAccount: vi.fn(),
        }),
      ),
    );

    const trigger = button("Codex usage details");
    expect(trigger.textContent).not.toContain("Default account");
    await act(async () => trigger.click());
    expect(document.body.textContent).toContain("Removed account");
    await act(async () => button("Switch Codex account").click());
    expect(document.body.textContent).toContain("Default account");
    expect(document.body.textContent).toContain("Work");
  });

  it("shows and deliberately consumes a banked reset", async () => {
    const onConsumeReset = vi.fn(async () => "reset" as const);
    act(() =>
      root.render(
        createElement(UsageProviderChip, {
          limits: codexLimits(),
          now,
          onConsumeReset,
        }),
      ),
    );

    await act(async () => button("Codex usage details").click());
    expect(document.body.textContent).toContain("2 resets available");
    expect(
      document.querySelector('[data-reset-mascot-mood="happy"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Referral reward");
    expect(document.body.textContent).toContain("Backup reset");
    expect(document.body.textContent).toContain("Expires in 12d");

    const list = document.querySelector(
      '[aria-label="Available banked resets"]',
    );
    expect(list?.classList.contains("overflow-y-auto")).toBe(true);
    const useButtons = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((item) => item.textContent === "Use reset");
    expect(useButtons).toHaveLength(2);
    act(() => useButtons[1]?.click());
    expect(document.body.textContent).toContain("Spend this reset now?");
    await act(async () => button("Confirm").click());

    expect(onConsumeReset).toHaveBeenCalledWith("reset-2");
    expect(document.body.textContent).toContain("Codex usage was reset.");
  });

  it("uses the project's picked mascot when banked resets are available", async () => {
    const project = "/repo/mascot-lab";
    saveTabGroupMascot(projectKey(project), "cat");
    act(() =>
      root.render(
        createElement(UsageProviderChip, {
          limits: codexLimits(),
          now,
          project,
        }),
      ),
    );

    await act(async () => button("Codex usage details").click());
    const mascot = document.querySelector('[data-reset-mascot-mood="happy"]');
    expect(mascot?.getAttribute("data-mascot-name")).toBe("joyful");
  });

  it("hides the banked resets card when no resets are available", async () => {
    const limits = codexLimits();
    limits.resetCredits = { availableCount: 0, credits: [] };
    act(() => root.render(createElement(UsageProviderChip, { limits, now })));

    await act(async () => button("Codex usage details").click());
    expect(document.body.textContent).not.toContain("Banked resets");
    expect(document.querySelector(".reset-mascot-scene")).toBeNull();
    expect(
      document.querySelector('[aria-label="Available banked resets"]'),
    ).toBeNull();
  });

  it("keeps aggregate-only resets visible as claimable rows", async () => {
    const limits = codexLimits();
    limits.resetCredits = {
      availableCount: 2,
      credits: limits.resetCredits?.credits?.slice(0, 1) ?? null,
    };
    const onConsumeReset = vi.fn(async () => "reset" as const);
    act(() =>
      root.render(
        createElement(UsageProviderChip, {
          limits,
          now,
          onConsumeReset,
        }),
      ),
    );

    await act(async () => button("Codex usage details").click());
    expect(document.body.textContent).toContain("Referral reward");
    expect(document.body.textContent).toContain("Banked reset 2");
    const useButtons = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((item) => item.textContent === "Use reset");
    expect(useButtons).toHaveLength(2);
  });
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
