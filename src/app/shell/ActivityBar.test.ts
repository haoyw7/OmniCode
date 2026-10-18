import { startMotionClock, stopMotionClock, finishMotion } from "../../../tests/helpers/sharedMotionClock";
// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurfaceVisibilityContext } from "../../shared/ui/SurfaceVisibility";
import { ActivityBar, type ActivityBarLayout } from "./ActivityBar";
import { useUpdateStatus } from "./useUpdateStatus";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  type UpdaterSnapshot,
} from "../model/updater";
import { setUiLanguage } from "../../shared/i18n/language";
import {
  loadUpdatePreferences,
  saveUpdatePreferences,
} from "../model/updatePreferences";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../model/updater", () => ({
  readAppVersion: vi.fn(async () => "0.7.0"),
  probeForUpdate: vi.fn(async () => null),
  installPendingUpdate: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof ActivityBar>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  localStorage.clear();
  setUiLanguage("en");
  vi.mocked(probeForUpdate).mockReset().mockResolvedValue(null);
  vi.mocked(readAppVersion).mockClear();
  vi.mocked(installPendingUpdate).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: "/work/alpha",
    recents: [{ path: "/work/beta", openedAt: 1 }],
    onSearch: vi.fn(),
    onOpenInbox: vi.fn(),
    onOpenNotes: vi.fn(),
    onOpenAutomations: vi.fn(),
    onOpenSettings: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  setUiLanguage("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});
function ActivityBarWindow({ layouts }: { layouts: ActivityBarLayout[] }) {
  const updateStatus = useUpdateStatus();
  return createElement(
    Fragment,
    null,
    ...layouts.map((layout) =>
      createElement(ActivityBar, {
        ...props,
        layout,
        updateStatus,
        key: layout,
      }),
    ),
  );
}
async function render(layouts: ActivityBarLayout[] = [props.layout ?? "rail"]) {
  await act(async () =>
    root.render(createElement(ActivityBarWindow, { layouts })),
  );
}
function action(label: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
function dialogAction(label: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-modal="true"] button',
    ),
  ].find((button) => button.textContent === label)!;
}

it("keeps a 48px bar with title-row fallback and routes destinations to workspace actions", async () => {
  await render();
  expect(container.querySelector("nav")?.classList.contains("w-12")).toBe(true);
  expect(
    container
      .querySelector('[data-window-drag-region="deep"]')
      ?.classList.contains("h-10"),
  ).toBe(true);
  props.chromeInMenuBar = true;
  await render();
  expect(container.querySelector('[data-window-drag-region="deep"]')).toBeNull();
  const quickOpen = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.title.startsWith("Quick Open"))!;
  expect(action("Notes")).toBeNull();
  act(() => {
    quickOpen.click();
    action("Inbox").click();
    action("Automations").click();
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.title.startsWith("Settings"))!
      .click();
  });
  for (const fn of [
    props.onSearch,
    props.onOpenInbox,
    props.onOpenAutomations,
    props.onOpenSettings,
  ])
    expect(fn).toHaveBeenCalledOnce();
  expect(props.onOpenNotes).not.toHaveBeenCalled();
  props.inboxActive = true;
  await render();
  expect(action("Inbox").getAttribute("aria-pressed")).toBe("true");
  act(() => action("Inbox").click());
  expect(props.onOpenInbox).toHaveBeenCalledTimes(2);
  props.chromeInMenuBar = false;
  await render();
  expect(
    container
      .querySelector('[data-window-drag-region="deep"]')
      ?.classList.contains("h-10"),
  ).toBe(true);
});

it("leaves the collapsed rail without a project entry", async () => {
  await render();
  expect(container.querySelector('[data-project-list="avatars"]')).toBeNull();
  expect(
    container.querySelector('button[aria-label="All projects"]'),
  ).toBeNull();
});

it("opens working agents from the bottom icon and selects sessions across projects", async () => {
  props.onSelectAgent = vi.fn();
  props.liveAgents = [
    {
      id: "a",
      cwd: "/work/alpha",
      title: "Build settings",
      harness: "codex",
      activity: "Editing",
      startedAt: Date.now(),
      needsApproval: false,
      done: false,
    },
    {
      id: "b",
      cwd: "/work/beta",
      title: "Review tests",
      harness: "claude",
      activity: "Testing",
      startedAt: Date.now(),
      needsApproval: true,
      done: false,
    },
  ];
  await render();
  expect(
    document.querySelector('[data-live-agents-preview="full"]'),
  ).toBeNull();
  await act(async () => action("Working agents, 2").click());
  expect(document.querySelectorAll("[data-live-agent-card]")).toHaveLength(2);
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[data-live-agent-card="b"]')!
      .click(),
  );
  expect(props.onSelectAgent).toHaveBeenCalledExactlyOnceWith("b");
  await act(async () => finishMotion());
  expect(
    document.querySelector('[data-live-agents-preview="full"]'),
  ).toBeNull();
});

it("offers a single working agent in its pop-out", async () => {
  props.onSelectAgent = vi.fn();
  props.liveAgents = [
    {
      id: "a",
      cwd: "/work/alpha",
      title: "Build settings",
      harness: "codex",
      activity: "Editing",
      startedAt: Date.now(),
      needsApproval: false,
      done: false,
    },
  ];
  await render();
  await act(async () => action("Working agents, 1").click());
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[data-live-agent-card="a"]')!
      .click(),
  );
  expect(props.onSelectAgent).toHaveBeenCalledExactlyOnceWith("a");
});

it("probes once and only displays updates when there is an available action", async () => {
  await render();
  expect(action("Updates")).toBeNull();
  props.inboxActive = true;
  await render();
  expect(probeForUpdate).toHaveBeenCalledOnce();
});

it("retries a failed launch check and shows the update without reopening the app", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(probeForUpdate)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ version: "0.7.1" } as Awaited<
        ReturnType<typeof probeForUpdate>
      >);
    await render();
    expect(action("Updates")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(probeForUpdate).toHaveBeenCalledTimes(2);
    expect(action("Updates")).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("opens the update confirmation without downloading", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({
    version: "0.7.1",
    date: "2026-09-30T00:00:00Z",
  } as Awaited<ReturnType<typeof probeForUpdate>>);
  await render();
  expect(action("Updates")).not.toBeNull();
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  await act(async () => action("Updates").click());
  expect(document.body.textContent).toContain("New version available  v0.7.1");
  expect(document.querySelector('[aria-modal="true"] time')?.textContent).toBe(
    "September 30, 2026",
  );
  expect(dialogAction("Skip this version")).toBeDefined();
  expect(dialogAction("Later")).toBeDefined();
  expect(dialogAction("Download update")).toBeDefined();
  expect(
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
  ).toBe(false);
  expect(installPendingUpdate).not.toHaveBeenCalled();
});

it.each(["rail", "sidebar-footer"] as const)(
  "previews remote release notes on hover in the %s layout and retains pointer transfer",
  async (layout) => {
    vi.mocked(probeForUpdate).mockResolvedValue({
      version: "3.14.5",
      date: "2026-09-30T00:00:00Z",
      body: "### 问题修复\n\n- 手动重置后，剩余重置机会的数量会保留显示。",
    } as Awaited<ReturnType<typeof probeForUpdate>>);
    await render([layout]);
    await act(async () => setUiLanguage("zh-CN"));
    const trigger = action("更新");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () =>
      trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })),
    );
    const panel = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(panel.textContent).toContain("v3.14.5 更新日志");
    expect(panel.querySelector("time")?.textContent).toBe("2026年9月30日");
    expect(panel.querySelector("h3")?.textContent).toBe("问题修复");
    expect(panel.querySelector("li")?.textContent).toContain("剩余重置机会");
    expect(trigger.getAttribute("aria-describedby")).toBe(panel.id);
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(installPendingUpdate).not.toHaveBeenCalled();

    act(() =>
      trigger.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: panel }),
      ),
    );
    expect(panel.getAttribute("aria-hidden")).not.toBe("true");
    act(() => panel.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(panel.getAttribute("aria-hidden")).not.toBe("true");
    act(() =>
      panel.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(true);
  },
);

it("supports keyboard preview and Escape when release notes are missing", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({ version: "9.9.9" } as Awaited<
    ReturnType<typeof probeForUpdate>
  >);
  await render();
  await act(async () => action("Updates").focus());
  const panel = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(panel.textContent).toContain("v9.9.9 Release notes");
  expect(panel.textContent).toContain(
    "Release notes for this version are not available",
  );
  expect(panel.querySelector("time")).toBeNull();
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(panel.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(action("Updates"));
});

it("dismisses the preview for confirmation and Later leaves the update available", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({
    version: "0.7.1",
    body: "### Fixed\n\n- Release preview regression.",
  } as Awaited<ReturnType<typeof probeForUpdate>>);
  await render();
  await act(async () => action("Updates").focus());
  await act(async () => action("Updates").click());
  await act(async () => finishMotion());
  expect(
    document.querySelector('[role="tooltip"]:not([aria-hidden="true"])'),
  ).toBeNull();
  await act(async () => dialogAction("Later").click());
  await act(async () => finishMotion());
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  expect(document.activeElement).toBe(action("Updates"));
  expect(action("Updates")).not.toBeNull();
  expect(loadUpdatePreferences().skippedVersion).toBeNull();
  expect(installPendingUpdate).not.toHaveBeenCalled();
});

it("remembers skipping the offered version and removes its update action", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({ version: "0.7.1" } as Awaited<
    ReturnType<typeof probeForUpdate>
  >);
  await render();
  await act(async () => action("Updates").click());
  await act(async () => dialogAction("Skip this version").click());
  await act(async () => finishMotion());
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  expect(action("Updates")).toBeNull();
  expect(loadUpdatePreferences().skippedVersion).toBe("0.7.1");
  expect(installPendingUpdate).not.toHaveBeenCalled();
});

it("persists the automatic update choice without installing the current version on toggle", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({ version: "0.7.1" } as Awaited<
    ReturnType<typeof probeForUpdate>
  >);
  await render();
  await act(async () => action("Updates").click());
  const checkbox = () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox().click());
  expect(loadUpdatePreferences().autoInstall).toBe(true);
  await act(async () => dialogAction("Later").click());
  await act(async () => finishMotion());
  await act(async () => action("Updates").click());
  expect(checkbox().checked).toBe(true);
  await act(async () => checkbox().click());
  expect(loadUpdatePreferences().autoInstall).toBe(false);
  expect(installPendingUpdate).not.toHaveBeenCalled();
});

it("installs automatically on a future probe only after opt-in", async () => {
  saveUpdatePreferences({ autoInstall: true });
  vi.mocked(probeForUpdate).mockResolvedValue({ version: "0.7.1" } as Awaited<
    ReturnType<typeof probeForUpdate>
  >);
  vi.mocked(installPendingUpdate).mockImplementation(async (onProgress) => {
    const snapshot: UpdaterSnapshot = {
      phase: "downloading",
      currentVersion: "0.7.0",
      availableVersion: "0.7.1",
      progress: 42,
    };
    onProgress?.(snapshot);
    return snapshot;
  });
  await render(["rail", "sidebar-footer"]);
  expect(installPendingUpdate).toHaveBeenCalledOnce();
  await act(async () => action("Updates").click());
  expect(dialogAction("Downloading 42%").disabled).toBe(true);
});

it("uses the installed version's bundled notes when only an update notice remains", async () => {
  props.updateNotice = { version: "0.7.0" };
  props.onOpenWhatsNew = vi.fn();
  props.onDismissUpdate = vi.fn();
  await render();
  await act(async () => action("Updates").focus());
  const panel = document.querySelector('[role="tooltip"]')!;
  expect(panel.textContent).toContain("v0.7.0 Release notes");
  expect(panel.querySelector("time")?.textContent).toBe("October 2, 2026");
  expect(panel.querySelector("h3")?.textContent).toBe("Added");
  expect(panel.querySelector("li")).not.toBeNull();
});

it("shares one update probe and keeps the install lock across activity layouts", async () => {
  vi.mocked(probeForUpdate).mockResolvedValue({ version: "0.7.1" } as Awaited<
    ReturnType<typeof probeForUpdate>
  >);
  let reportProgress!: (snapshot: UpdaterSnapshot) => void;
  let finishInstall!: (snapshot: UpdaterSnapshot) => void;
  vi.mocked(installPendingUpdate).mockImplementation(
    (onProgress) =>
      new Promise((resolve) => {
        reportProgress = onProgress!;
        finishInstall = resolve;
      }),
  );
  await render(["rail", "sidebar-top", "sidebar-footer"]);
  expect(probeForUpdate).toHaveBeenCalledOnce();
  expect(readAppVersion).toHaveBeenCalledOnce();
  await act(async () => action("Updates").click());
  const installButton = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[aria-modal="true"] button',
      ),
    ].find((button) => /^Download/.test(button.textContent ?? ""))!;
  act(() => {
    installButton().click();
    installButton().click();
  });
  expect(installPendingUpdate).toHaveBeenCalledOnce();

  // The install has not even reported downloading yet. Switching layouts
  // unmounts its old button, but the workspace still owns the install lock.
  await render(["sidebar-top", "sidebar-footer"]);
  await act(async () => action("Updates").click());
  expect(installButton().disabled).toBe(true);
  expect(installButton().textContent).toContain("Downloading…");
  act(() => installButton().click());
  expect(installPendingUpdate).toHaveBeenCalledOnce();

  act(() =>
    reportProgress({
      phase: "downloading",
      currentVersion: "0.7.0",
      availableVersion: "0.7.1",
      progress: 42,
    }),
  );
  await render(["rail"]);
  await act(async () => action("Updates").click());
  expect(installButton().textContent).toContain("Downloading 42%");
  expect(installButton().disabled).toBe(true);
  expect(probeForUpdate).toHaveBeenCalledOnce();
  await act(async () =>
    finishInstall({ phase: "downloading", currentVersion: "0.7.0" }),
  );
});

it("localizes shell labels and tooltips while preserving project names", async () => {
  await render();
  await act(async () => setUiLanguage("zh-CN"));
  expect(container.querySelector('nav[aria-label="活动栏"]')).not.toBeNull();
});

it("keeps installed update notes accessible from the updates pop-out", async () => {
  props.updateNotice = { version: "0.7.0" };
  props.onOpenWhatsNew = vi.fn();
  props.onDismissUpdate = vi.fn();
  await render();
  await act(async () => action("Updates").click());
  const card = document.querySelector('[role="dialog"][aria-label="Updates"]')!;
  expect(card.textContent).toContain("Updated to 0.7.0");
  act(() =>
    [...card.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("What's new"))!
      .click(),
  );
  expect(props.onOpenWhatsNew).toHaveBeenCalledExactlyOnceWith("0.7.0");
  await act(async () => finishMotion());
  expect(
    document.querySelector('[role="dialog"][aria-label="Updates"]'),
  ).toBeNull();
  await act(async () => action("Updates").click());
  act(() =>
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Dismiss update notification"]',
      )!
      .click(),
  );
  expect(props.onDismissUpdate).toHaveBeenCalledOnce();
  await act(async () => finishMotion());
  expect(
    document.querySelector('[role="dialog"][aria-label="Updates"]'),
  ).toBeNull();
});

it("keeps all five named destinations and their actions in the title bar", async () => {
  props.layout = "titlebar";
  props.onOpenWorkflows = vi.fn();
  props.inboxUnseen = true;
  props.workflowsActive = true;
  await render();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Search",
    "Inbox",
    "Notes",
    "Automations",
    "Workflows",
  ]);
  expect(buttons.every((button) => button.querySelector("svg"))).toBe(true);
  expect(action("Workflows").getAttribute("aria-pressed")).toBe("true");
  expect(action("Inbox, new items")).not.toBeNull();
  act(() => buttons.forEach((button) => button.click()));
  for (const handler of [
    props.onSearch,
    props.onOpenInbox,
    props.onOpenNotes,
    props.onOpenAutomations,
    props.onOpenWorkflows,
  ]) {
    expect(handler).toHaveBeenCalledOnce();
  }
  props.notesEnabled = false;
  await render();
  expect(action("Notes")).toBeNull();
});

it("dismisses the inbox context menu when its navigation is hidden", async () => {
  props.layout = "titlebar";
  const renderVisible = async (visible: boolean) => {
    await act(async () =>
      root.render(
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: visible },
          createElement(ActivityBar, props),
        ),
      ),
    );
  };
  await renderVisible(true);
  act(() =>
    action("Inbox").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await renderVisible(false);
  await act(async () => finishMotion());
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await renderVisible(true);
  await act(async () => finishMotion());
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
