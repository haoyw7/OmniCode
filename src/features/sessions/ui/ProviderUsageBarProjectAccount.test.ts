// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderRateLimits, Session } from "../../../contracts/session";
import { clearCachedRateLimits, setCachedRateLimits } from "../../providers/model/rateLimitsCache";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../../domain/providerAccount";
import { renameProviderAccount, saveProviderAccount, selectedProviderAccountId } from "../../providers/model/providerAccounts";
import { newSession, retargetSessionToProject } from "../model/session";

import { ProviderUsageBar } from "./ProviderUsageBar";
import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

const WORK_ACCOUNT_ID = "account-work";
const PROJECT_A = "/repo/a";
const PROJECT_B = "/repo/b";

function claudeLimits(): ProviderRateLimits {
  return {
    provider: "claude",
    session: {
      usedPercent: 10,
      windowMinutes: 300,
      resetsAt: Date.now() + 3_600_000,
    },
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  renameProviderAccount("claude", DEFAULT_PROVIDER_ACCOUNT_ID, "Personal");
  saveProviderAccount({
    id: WORK_ACCOUNT_ID,
    provider: "claude",
    label: "Work",
  });
  setCachedRateLimits("claude", DEFAULT_PROVIDER_ACCOUNT_ID, claudeLimits());
  setCachedRateLimits("claude", WORK_ACCOUNT_ID, claudeLimits());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  clearCachedRateLimits();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

/** The usage bar for the focused session. */
async function renderUsageBar(
  session: Session,
  onSelectAccount: (provider: string, accountId: string) => void = () => {},
) {
  await act(async () =>
    root.render(
      createElement(ProviderUsageBar, {
        providers: ["claude"],
        project: session.cwd,
        session: {
          id: session.id,
          harness: session.harness,
          model: session.model,
          providerAccountId: session.providerAccountId,
        },
        onSelectAccount,
      }),
    ),
  );
}

async function openAccountPicker() {
  await act(async () => button("Claude Code usage details").click());
  await act(async () => button("Switch Claude Code account").click());
}

describe("ProviderUsageBar account per project", () => {
  it("keeps another project on its own account after a blank session moves there", async () => {
    let session = newSession("claude", PROJECT_A, "claude:opus-5");

    // Project A: the user picks Work. App stamps the blank session
    // (onSelectProviderAccount) and the usage bar saves the project selection.
    await renderUsageBar(session, (_provider, accountId) => {
      session = { ...session, providerAccountId: accountId };
    });
    await openAccountPicker();
    await act(async () => button("Work").click());
    await act(async () => completeMotionAnimation(document.body));
    expect(selectedProviderAccountId("claude", PROJECT_A)).toBe(
      WORK_ACCOUNT_ID,
    );
    expect(session.providerAccountId).toBe(WORK_ACCOUNT_ID);

    // The user opens project B. App reuses the blank session (onCwdChange).
    session = retargetSessionToProject(session, PROJECT_B);
    expect(selectedProviderAccountId("claude", PROJECT_B)).toBe(
      DEFAULT_PROVIDER_ACCOUNT_ID,
    );

    await renderUsageBar(session);
    await openAccountPicker();
    expect(button("Personal").getAttribute("aria-pressed")).toBe("true");
    expect(button("Work").getAttribute("aria-pressed")).toBe("false");
  });
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
