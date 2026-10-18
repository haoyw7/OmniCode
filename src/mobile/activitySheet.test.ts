import { advanceMotionTimers, startMotionClock, stopMotionClock } from "./motionTestClock";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MobileTranscript } from "./MobileTranscript";
import type { HostSession } from "../features/connections/model/protocol";
import type { Block } from "../features/sessions/model/session";
import { setUiLanguage } from "../shared/i18n/language";
import { backMobileSheet } from "./mobileSheetBack";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  startMotionClock();
  setUiLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setUiLanguage("en");
});

const edit = (id: string, path: string): Block => ({
  id,
  role: "tool",
  text: `Edited ${path}`,
  tool: {
    kind: "edit",
    title: `Edited ${path}`,
    status: "completed",
    preview: { kind: "write", path, fileName: path, additions: 2, deletions: 1 },
  },
});
const shell = (id: string, status = "completed"): Block => ({
  id,
  role: "tool",
  text: "bash npm test",
  tool: { kind: "shell", title: "bash npm test", status, detail: "npm test", preview: { kind: "shell", output: "ok" } },
});

function render(blocks: Block[], status: HostSession["status"] = "idle", readBinaryFile?: (path: string) => Promise<Uint8Array>) {
  const node = document.createElement("div");
  node.className = "mobile-app";
  document.body.append(node);
  const snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status,
    runId: status === "running" ? "run" : undefined,
    updatedAt: 1,
    session: {
      id: "session",
      title: "Test",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks,
    },
  };
  act(() => {
    root = createRoot(node);
    root.render(createElement(MobileTranscript, { snapshot, disabled: false, onCommand: () => {}, readBinaryFile }));
  });
  const update = (nextBlocks: Block[], nextStatus = status) => {
    act(() => root!.render(createElement(MobileTranscript, {
      snapshot: { ...snapshot, status: nextStatus, session: { ...snapshot.session, blocks: nextBlocks } },
      disabled: false, onCommand: () => {}, readBinaryFile,
    })));
  };
  return { node, update };
}

const settledTurn: Block[] = [
  { id: "user", role: "user", text: "Fix it", startedAt: 1 },
  edit("a", "a.ts"),
  shell("b"),
  { id: "answer", role: "assistant", text: "Done." },
];
const dialog = () =>
  document.querySelector<HTMLElement>('.mobile-sheet-backdrop:not([inert]) [role="dialog"]');
const currentPage = () => dialog()!.querySelector<HTMLElement>('[data-page-active="true"]')!;
const finishNavigation = () => advanceMotionTimers(600);

describe("mobile activity sheet", () => {
  it("opens a settled group's steps in a sheet, then a step's details with a way back", async () => {
    const { node } = render(settledTurn);
    // The turn's fold line is the one tap between the answer and its steps.
    const fold = node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!;
    expect(fold.getAttribute("aria-label")).toBe("Show the work");
    expect(fold.hasAttribute("aria-expanded")).toBe(false);
    expect(fold.textContent).toContain("+2−1");
    await act(async () => { fold.click(); await vi.dynamicImportSettled(); });
    const sheet = dialog()!;
    sheet.dataset.detent = "full";
    sheet.style.transform = "translateY(0px)";
    const scroll = currentPage().querySelector<HTMLElement>("[data-mobile-page-scroll]")!;
    scroll.scrollTop = 180;
    scroll.dispatchEvent(new Event("scroll"));
    expect(node.querySelector(".mobile-session-row, .zen-phase-body")).toBeNull();
    const steps = [...dialog()!.querySelectorAll(".mobile-activity-step")];
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining("a.ts"),
      expect.stringContaining("npm test"),
    ]);
    expect(steps[0].querySelector(".mobile-activity-diff")?.textContent).toBe("+2−1");
    act(() => steps[1].querySelector("button")!.click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()).toBe(sheet);
    expect(sheet.dataset.detent).toBe("full");
    expect(sheet.style.transform).toBe("translateY(0px)");
    expect(currentPage().style.transform).toBe("translateX(100%)");
    const outgoing = sheet.querySelector('[data-page-active="false"]')!;
    expect(outgoing.hasAttribute("inert")).toBe(true);
    expect(outgoing.getAttribute("aria-hidden")).toBe("true");
    expect(dialog()?.querySelector(".mobile-tool-sheet")).not.toBeNull();
    expect(dialog()?.textContent).toContain("ok");
    await finishNavigation();
    expect(sheet.querySelector(".mobile-activity-sheet")).toBeNull();
    const back = [...currentPage().querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.getAttribute("aria-label") === "Back")!;
    act(() => back.click());
    expect(dialog()).toBe(sheet);
    expect(currentPage().style.transform).toBe("translateX(-100%)");
    expect(currentPage().querySelector<HTMLElement>("[data-mobile-page-scroll]")!.scrollTop).toBe(180);
    expect(sheet.querySelector(".mobile-tool-sheet")).not.toBeNull();
    await finishNavigation();
    expect(sheet.querySelector(".mobile-tool-sheet")).toBeNull();
    expect(dialog()?.querySelector(".mobile-activity-sheet")).not.toBeNull();
  });

  it("reverses immediately inside the same sheet and keeps keyboard focus on the active page", async () => {
    const { node } = render(settledTurn);
    await act(async () => { node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!.click(); await vi.dynamicImportSettled(); });
    const sheet = dialog();
    const list = currentPage();
    const step = list.querySelectorAll<HTMLButtonElement>(".mobile-activity-step > button")[1];
    act(() => step.click());
    const back = currentPage().querySelector<HTMLButtonElement>('[aria-label="Back"]')!;
    expect(document.activeElement).toBe(back);
    act(() => back.click());
    expect(currentPage()).toBe(list);
    act(() => step.click());
    expect(dialog()).toBe(sheet);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const buttons = currentPage().querySelectorAll<HTMLButtonElement>("button");
    act(() => {
      buttons[buttons.length - 1].focus();
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(buttons[0]);
    await finishNavigation();
    expect(sheet!.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
    expect(currentPage().querySelector(".mobile-tool-sheet")).not.toBeNull();
  });

  it("switches without retaining an outgoing page when reduced motion is requested", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { node } = render(settledTurn);
    await act(async () => { node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!.click(); await vi.dynamicImportSettled(); });
    const sheet = dialog();
    act(() => currentPage().querySelector<HTMLButtonElement>(".mobile-activity-step > button")!.click());
    expect(dialog()).toBe(sheet);
    expect(sheet!.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
    expect(currentPage().hasAttribute("data-page-motion")).toBe(false);
    act(() => currentPage().querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
    expect(currentPage().querySelector(".mobile-activity-sheet")).not.toBeNull();
    expect(sheet!.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
  });

  it.each(["header", "native", "Escape"])("returns one level at a time from a tool's file with %s", async (method) => {
    const back = () => act(() => {
      if (method === "native") expect(backMobileSheet()).toBe(true);
      else if (method === "Escape") dialog()!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      else dialog()!.querySelector<HTMLButtonElement>('[aria-label="Back"], [aria-label="Close"]')!.click();
    });
    const { node } = render(settledTurn, "idle", async () => new TextEncoder().encode("export const value = 1;"));
    await act(async () => { node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!.click(); await vi.dynamicImportSettled(); });
    act(() => currentPage().querySelector<HTMLButtonElement>(".mobile-activity-step > button")!.click());
    await finishNavigation();
    const viewFile = [...currentPage().querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "View file")!;
    await act(async () => { viewFile.click(); await vi.dynamicImportSettled(); });
    await finishNavigation();
    expect(dialog()!.querySelector(".mobile-file-sheet")).not.toBeNull();
    back();
    await finishNavigation();
    expect(currentPage().querySelector(".mobile-tool-sheet")).not.toBeNull();
    back();
    await finishNavigation();
    expect(currentPage().querySelectorAll(".mobile-activity-step")).toHaveLength(2);
    back();
    expect(dialog()).toBeNull();
    await finishNavigation();
    expect(node.querySelector(".mobile-sheet-backdrop")).toBeNull();
  });

  it("opens a live group's steps from its header while the turn runs", async () => {
    const { node } = render([
      { id: "user", role: "user", text: "Fix it", startedAt: Date.now() },
      edit("a", "a.ts"),
      shell("b", "pending"),
    ], "running");
    const group = node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!;
    expect(group.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => { group.click(); await vi.dynamicImportSettled(); });
    const running = dialog()!.querySelectorAll(".mobile-activity-step")[1];
    expect(running.querySelector(".mobile-spin")).not.toBeNull();
  });

  it("refreshes an open activity sheet as steps arrive and finish without mixing later groups", async () => {
    const user: Block = { id: "user", role: "user", text: "Fix it", startedAt: Date.now() };
    const { node, update } = render([user, edit("a", "a.ts"), shell("b", "pending")], "running");
    await act(async () => {
      node.querySelector<HTMLButtonElement>("[data-activity-sheet]")!.click();
      await vi.dynamicImportSettled();
    });
    const sheet = dialog();
    update([user, edit("a", "a.ts"), shell("b"), shell("c", "pending")]);
    expect(dialog()).toBe(sheet);
    expect(currentPage().querySelectorAll(".mobile-activity-step")).toHaveLength(3);
    expect(currentPage().querySelectorAll(".mobile-spin")).toHaveLength(1);
    // New rows open their current details and still return to the same live list.
    act(() => currentPage().querySelectorAll<HTMLButtonElement>(".mobile-activity-step button")[2].click());
    await finishNavigation();
    update([user, edit("a", "a.ts"), shell("b"), shell("c"), edit("d", "d.ts")]);
    act(() => currentPage().querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
    await finishNavigation();
    expect(currentPage().querySelectorAll(".mobile-activity-step")).toHaveLength(4);
    expect(currentPage().querySelector(".mobile-spin")).toBeNull();
    update([
      user, edit("a", "a.ts"), shell("b"), shell("c"), edit("d", "d.ts"),
      { id: "next-phase", role: "assistant", text: "Now check another file." },
      edit("later", "later.ts"),
      { id: "next-user", role: "user", text: "Another request" },
      edit("other-turn", "other-turn.ts"),
    ], "idle");
    expect(currentPage().querySelectorAll(".mobile-activity-step")).toHaveLength(4);
    expect(currentPage().textContent).not.toContain("later.ts");
    expect(currentPage().textContent).not.toContain("other-turn.ts");
  });

  it("keeps a group with a pending approval inline so it can be answered", async () => {
    const { node } = render([
      { id: "user", role: "user", text: "Fix it", startedAt: 1 },
      edit("a", "a.ts"),
      { ...shell("b", "pending"), approval: { requestId: 3 } },
    ], "running");
    expect(node.querySelector("[data-activity-sheet]")).toBeNull();
    expect([...node.querySelectorAll("button")].some((button) => button.textContent === "Allow")).toBe(true);
  });
});

describe("mobile live turn footer", () => {
  it("shows the project mascot and the running tool verb under the live reply", async () => {
    const { node } = render([
      { id: "user", role: "user", text: "Fix it", startedAt: Date.now() - 65_000 },
      edit("a", "a.ts"),
      { ...shell("b", "pending"), startedAt: Date.now() - 5_000 },
    ], "running");
    const footer = node.querySelector("[data-live-footer]")!;
    expect(footer.querySelector("svg[data-ui=omi][data-animated]")).not.toBeNull();
    // A running tool shows only its verb; clocks are reserved for thinking and replies.
    expect(footer.getAttribute("data-live-phase")).toBe("tool");
    expect(footer.hasAttribute("data-live-clock")).toBe(false);
    const verb = footer.textContent;
    expect(verb).toMatch(/^\S[^·]*…$/);
    await advanceMotionTimers(1000);
    expect(footer.textContent).toBe(verb);
    expect(node.textContent).not.toMatch(/\b[56]s\b/);
  });

  it("has no footer once the turn settles", async () => {
    const { node } = render(settledTurn);
    expect(node.querySelector("[data-live-footer]")).toBeNull();
  });

  it("shows the finished time and compact duration below the answer", async () => {
    setUiLanguage("zh-CN");
    const { node } = render([
      { id: "user", role: "user", text: "Fix it", startedAt: 1_000, durationMs: 8_000 },
      shell("b"),
      { id: "answer", role: "assistant", text: "Done." },
    ]);
    const footer = node.querySelector('[aria-label="运行耗时 8s"]')!;
    expect(footer.textContent).toContain("8s");
    expect(footer.textContent).not.toContain("运行耗时");
    expect(footer.querySelector("time")?.dateTime).toBe(new Date(9_000).toISOString());
    expect(node.textContent).toContain("Done.");
    expect(node.textContent?.match(/8s/g)).toHaveLength(1);
  });
});
