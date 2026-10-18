import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSession } from "../features/connections/model/protocol";
import { newSession, type Block } from "../features/sessions/model/session";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileTranscript } from "./MobileTranscript";
import { backMobileSheet } from "./mobileSheetBack";

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  setUiLanguage("en");
  app = document.createElement("div");
  app.className = "mobile-app";
  document.body.append(app);
  root = createRoot(app);
});
afterEach(() => {
  act(() => root.unmount());
  app.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setUiLanguage("en");
});

const tasks = (count = 3, completed = 1): Block => ({
  id: "tasks",
  role: "tasks",
  text: "",
  taskList: {
    items: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      text: `Task ${i + 1}`,
      status:
        i < completed
          ? "completed"
          : i === completed
            ? "in_progress"
            : "pending",
    })),
  },
});
const plan: Block = {
  id: "plan",
  role: "plan",
  text: "# Implementation plan\n\nKeep the public API stable.",
};
const agent: Block = {
  id: "agent",
  role: "tool",
  text: "Review changes",
  tool: { callId: "agent", kind: "Agent", status: "in_progress" },
  agentRun: {
    name: "Review changes",
    model: "review-model",
    steps: [],
    transcript: [
      { id: "reply", role: "assistant", text: "Checking compatibility." },
    ],
  },
};

function render(blocks: Block[], backgroundTasks?: string[], readBinaryFile?: (path: string) => Promise<Uint8Array>) {
  let snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status: "running",
    runId: "run",
    updatedAt: 1,
    session: {
      ...newSession("codex", "/repo"),
      id: "session",
      blocks,
      backgroundTasks,
    },
  };
  const onOverlayChange = vi.fn();
  let props: ComponentProps<typeof MobileTranscript> = {
    snapshot,
    disabled: false,
    onCommand: vi.fn(),
    onOverlayChange,
    readBinaryFile,
  };
  const update = (changes: Partial<HostSession> = {}, active = true) => {
    snapshot = { ...snapshot, ...changes };
    props = { ...props, snapshot, active };
    act(() => root.render(createElement(MobileTranscript, props)));
  };
  update();
  return { snapshot, update, onOverlayChange };
}
const capsule = () =>
  app.querySelector<HTMLButtonElement>(".mobile-progress-capsule");
const dialog = () =>
  app.querySelector<HTMLElement>(
    '.mobile-sheet-backdrop:not([inert]) [role="dialog"]',
  );
const click = (element: HTMLElement) => act(() => element.click());
const finish = () => advanceMotionTimers(600);
const row = (text: string) =>
  [
    ...dialog()!.querySelectorAll<HTMLButtonElement>(".mobile-progress-row"),
  ].find((button) => button.textContent?.includes(text))!;

describe("mobile session progress", () => {
  it("returns through linked files and their plan to the progress sheet", async () => {
    const read = vi.fn(async (path: string) => new TextEncoder().encode(
      path.endsWith("first.md") ? "[Second file](/repo/second.md)" : "Second file contents",
    ));
    render([tasks(), { ...plan, text: "# Implementation plan\n\n[First file](/repo/first.md)" }], undefined, read);
    click(capsule()!);
    click(row("Implementation plan"));
    await finish();
    await act(async () => {
      dialog()!.querySelector<HTMLAnchorElement>('a[href="/repo/first.md"]')!.click();
      await vi.dynamicImportSettled();
    });
    await finish();
    await act(async () => {
      dialog()!.querySelector<HTMLAnchorElement>('a[href="/repo/second.md"]')!.click();
      await vi.dynamicImportSettled();
    });
    expect(dialog()?.textContent).toContain("Second file contents");
    await act(async () => { expect(backMobileSheet()).toBe(true); });
    expect(dialog()?.textContent).toContain("first.md");
    act(() => { expect(backMobileSheet()).toBe(true); });
    expect(dialog()?.getAttribute("aria-label")).toBe("Plan");
    // A closing child must not intercept another immediate Back.
    act(() => { expect(backMobileSheet()).toBe(true); });
    expect(dialog()?.getAttribute("aria-label")).toBe("Session progress");
  });

  it.each(["plan", "agent"])("returns from %s details to progress before closing", async (kind) => {
    render([tasks(), plan, agent]);
    click(capsule()!);
    click(row(kind === "plan" ? "Implementation plan" : "Review changes"));
    await act(async () => vi.dynamicImportSettled());
    await finish();
    expect(dialog()?.getAttribute("aria-label")).toBe(kind === "plan" ? "Plan" : "Subagent conversation");
    act(() => { expect(backMobileSheet()).toBe(true); });
    expect(dialog()?.getAttribute("aria-label")).toBe("Session progress");
    await finish();
    act(() => { expect(backMobileSheet()).toBe(true); });
    expect(dialog()).toBeNull();
    await finish();
    expect(backMobileSheet()).toBe(false);
  });

  it("keeps completed agents accessible without showing them as running", async () => {
    const completed = { ...agent, tool: { ...agent.tool, status: "completed" } };
    const { update } = render([completed]);
    update({ status: "idle" });
    expect(capsule()?.textContent).toContain("1 subagent");
    expect(capsule()?.textContent).not.toContain("running");
    click(capsule()!);
    const toggle = dialog()!.querySelector<HTMLButtonElement>("h3 button")!;
    expect(toggle.textContent).toContain("1 subagent");
    const section = toggle.closest("section")!;
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(section.querySelector('[data-fold-state="closing"][inert]')).not.toBeNull();
    await finish();
    expect(section.textContent).not.toContain("Review changes");
    click(toggle);
    await finish();
    expect(row("Review changes").querySelector('[title="Completed"]')).not.toBeNull();
    expect(row("Review changes").textContent).toContain("0 steps");
    click(row("Review changes"));
    await act(async () => vi.dynamicImportSettled());
    expect(dialog()?.textContent).toContain("Checking compatibility.");
  });

  it("hides ordinary chats and follows live task snapshots, including idle completion", async () => {
    const { snapshot, update } = render([
      { id: "user", role: "user", text: "Hello" },
    ]);
    expect(capsule()).toBeNull();
    update({ session: { ...snapshot.session, blocks: [tasks()] } });
    expect(capsule()?.textContent).toContain("Task 2");
    expect(capsule()?.textContent).toContain("1 of 3");
    click(capsule()!);
    expect(dialog()?.getAttribute("aria-label")).toBe("Session progress");
    update({ session: { ...snapshot.session, blocks: [tasks(3, 2)] } });
    expect(capsule()?.textContent).toContain("Task 3");
    expect(
      dialog()?.querySelector('[data-status="in_progress"]')?.textContent,
    ).toContain("Task 3");
    update({
      status: "idle",
      session: { ...snapshot.session, blocks: [tasks(3, 3)] },
    });
    expect(dialog()).toBeNull();
    const closing = app.querySelector(
      '.mobile-sheet-backdrop[data-fold-state="closing"]',
    )!;
    expect(closing.hasAttribute("inert")).toBe(true);
    expect(closing.textContent).toContain("Task 3");
    expect(capsule()?.closest("[inert]")).not.toBeNull();
    expect(capsule()?.textContent).toContain("Task 3");
    await finish();
    expect(capsule()).toBeNull();
    expect(app.querySelector(".mobile-sheet-backdrop")).toBeNull();
    // New work should bring back only the capsule, not reopen the old sheet.
    update({
      status: "running",
      session: { ...snapshot.session, blocks: [tasks()] },
    });
    expect(capsule()).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it("opens the existing plan and agent details and follows their live data", async () => {
    const { snapshot, update } = render(
      [tasks(), plan, agent],
      ["npm run dev"],
    );
    click(capsule()!);
    expect(dialog()?.textContent).toContain("npm run dev");
    click(row("Implementation plan"));
    expect(dialog()?.getAttribute("aria-label")).toBe("Plan");
    expect(dialog()?.textContent).toContain("Keep the public API stable.");
    await finish();
    click(dialog()!.querySelector<HTMLButtonElement>('[aria-label="Back"]')!);
    await finish();
    expect(dialog()?.getAttribute("aria-label")).toBe("Session progress");
    click(row("Review changes"));
    await act(async () => vi.dynamicImportSettled());
    expect(dialog()?.textContent).toContain("Checking compatibility.");
    await act(async () =>
      update({
        session: {
          ...snapshot.session,
          blocks: [
            tasks(),
            plan,
            {
              ...agent,
              agentRun: {
                ...agent.agentRun!,
                transcript: [
                  {
                    id: "reply",
                    role: "assistant",
                    text: "Checking compatibility. Compatibility verified.",
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(dialog()?.textContent).toContain("Compatibility verified.");
  });

  it("focuses a long checklist and keeps folded rows inert through rapid reversal", async () => {
    render([tasks(8, 4)]);
    click(capsule()!);
    const more = dialog()!.querySelector<HTMLButtonElement>(
      ".mobile-progress-more",
    )!;
    expect(
      dialog()?.querySelectorAll(".mobile-progress-tasks li"),
    ).toHaveLength(3);
    click(more);
    await finish();
    expect(
      dialog()?.querySelectorAll(".mobile-progress-tasks li"),
    ).toHaveLength(8);
    click(more);
    expect(
      dialog()?.querySelector('[data-fold-state="closing"][inert]')
        ?.textContent,
    ).toContain("Task 1");
    click(more);
    await finish();
    expect(
      dialog()?.querySelectorAll(".mobile-progress-tasks li"),
    ).toHaveLength(8);
    click(more);
    await finish();
    expect(
      dialog()?.querySelectorAll(".mobile-progress-tasks li"),
    ).toHaveLength(3);
  });

  it("registers native Back dismissal, supports rapid reopen and releases hidden portals", async () => {
    const { update, onOverlayChange } = render([tasks()]);
    click(capsule()!);
    const close = onOverlayChange.mock.calls.at(-1)?.[0] as () => void;
    expect(close).toBeTypeOf("function");
    act(() => close());
    expect(dialog()).toBeNull();
    expect(app.querySelector(".mobile-sheet-backdrop[inert]")).not.toBeNull();
    click(capsule()!);
    await finish();
    expect(dialog()).not.toBeNull();
    update({}, false);
    expect(dialog()).toBeNull();
    expect(onOverlayChange.mock.calls.at(-1)?.[0]).toBeUndefined();
    await finish();
    expect(app.querySelector(".mobile-sheet-backdrop")).toBeNull();
    update();
    expect(dialog()).toBeNull();
  });

  it("localizes application text while preserving provider text and running counts", async () => {
    render([agent], ["npm run dev"]);
    expect(capsule()?.textContent).toContain("2 running");
    act(() => setUiLanguage("zh-CN"));
    expect(capsule()?.getAttribute("aria-label")).toBe("会话进度");
    click(capsule()!);
    expect(dialog()?.textContent).toContain("后台");
    expect(dialog()?.querySelector("h3 button")?.textContent).toContain("1 个子智能体");
    expect(row("Review changes").textContent).toContain("0 步");
    expect(dialog()?.textContent).toContain("Review changes");
    expect(dialog()?.textContent).toContain("review-model");
    expect(dialog()?.textContent).toContain("npm run dev");
  });
});
