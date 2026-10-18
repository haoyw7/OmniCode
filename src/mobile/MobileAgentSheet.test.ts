import { advanceMotionTimers, startMotionClock, stopMotionClock } from "./motionTestClock";
import { MobileActivitySheet } from "./MobileActivitySheet";
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MobileTranscript } from "./MobileTranscript";
import { MobileAgentSheet } from "./MobileAgentSheet";
import { backMobileSheet } from "./mobileSheetBack";
import type { Block } from "../features/sessions/model/session";
import type { HostSession } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
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
  document.body.replaceChildren();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const agent = (id = "root"): Block => ({
  id,
  role: "tool",
  text: id,
  tool: { callId: id, kind: "agent", status: "in_progress" },
  agentRun: { name: id, steps: [], transcript: [] },
});
const page = () => app.querySelector<HTMLElement>('[data-page-active="true"]')!;
const button = (label: string) =>
  [...page().querySelectorAll<HTMLButtonElement>("button")].find(
    (node) =>
      node.textContent?.includes(label) ||
      node.getAttribute("aria-label") === label,
  )!;
const click = (node: HTMLElement) => act(() => node.click());
const finish = () => advanceMotionTimers(600);

it("opens empty agent rows from the main stream and follows live snapshots", async () => {
  let block = agent();
  const render = () => {
    const snapshot: HostSession = {
      projectId: "p",
      revision: 1,
      status: "running",
      runId: "run",
      updatedAt: 1,
      session: {
        id: "s",
        title: "S",
        cwd: "/repo",
        harness: "claude",
        model: "test",
        modelSettings: {},
        runtimeMode: "supervised",
        blocks: [{ id: "user", role: "user", text: "Review" }, block],
      },
    };
    act(() =>
      root.render(
        createElement(MobileTranscript, {
          snapshot,
          disabled: false,
          onCommand: () => {},
        }),
      ),
    );
  };
  render();
  click(
    app.querySelector<HTMLButtonElement>('[aria-label="Show root\'s work"]')!,
  );
  await act(async () => vi.dynamicImportSettled());
  expect(page().textContent).toContain("Waiting for subagent messages");
  block = {
    ...block,
    agentRun: {
      ...block.agentRun!,
      transcript: [{ id: "reply", role: "assistant", text: "Full live reply" }],
    },
  };
  render();
  expect(page().textContent).toContain("Full live reply");
  click(button("Close"));
  expect(
    app
      .querySelector(".mobile-sheet-backdrop")
      ?.getAttribute("data-fold-state"),
  ).toBe("closing");
  expect(app.querySelector<HTMLElement>(".mobile-sheet-backdrop")?.inert).toBe(
    true,
  );
  click(
    app.querySelector<HTMLButtonElement>('[aria-label="Show root\'s work"]')!,
  );
  await finish();
  expect(page().textContent).toContain("Full live reply");
});

it.each(["header", "native", "Escape"])("navigates nested agents, tools and files with %s, preserving scroll", async (method) => {
  const back = () => act(() => {
    if (method === "native") expect(backMobileSheet()).toBe(true);
    else if (method === "Escape") page().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));
    else button("Back").click();
  });
  // The shared transcript distinguishes reader scrolling from layout changes.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
  const offsets = new WeakMap<HTMLElement, number>();
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
    return offsets.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) {
    offsets.set(this, Math.max(0, Math.min(value, 600)));
  });
  const child = agent("child");
  child.agentRun!.transcript = [
    {
      id: "tool",
      role: "tool",
      text: "Read file",
      tool: {
        kind: "read",
        status: "completed",
        input: "/repo/a.txt",
        output: "result".repeat(2000),
        preview: { kind: "read", path: "/repo/a.txt" },
      },
    },
  ];
  const block = agent();
  block.agentRun!.transcript = [
    child,
    { id: "reply", role: "assistant", text: "Root reply" },
  ];
  act(() =>
    root.render(
      createElement(MobileAgentSheet, {
        open: true,
        onExited: () => {},
        blocks: [block],
        blockId: "root",
        cwd: "/repo",
        readBinaryFile: async () => new TextEncoder().encode("File body"),
        onClose: () => {},
      }),
    ),
  );
  const scroll = page().querySelector<HTMLElement>(
    "[data-mobile-page-scroll]",
  )!;
  act(() => {
    scroll.scrollTop = 120;
    scroll.dispatchEvent(new Event("scroll"));
  });
  click(button("child"));
  await finish();
  click(
    page().querySelector<HTMLButtonElement>(
      '[data-tool-open-row]',
    )!,
  );
  await finish();
  expect(page().textContent).toContain("result".repeat(2000));
  await act(async () => button("View file").click());
  await finish();
  expect(page().textContent).toContain("File body");
  expect(app.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  back();
  await finish();
  expect(page().textContent).toContain("result".repeat(2000));
  back();
  await finish();
  back();
  await finish();
  expect(page().textContent).toContain("Root reply");
  expect(
    page().querySelector<HTMLElement>("[data-mobile-page-scroll]")!.scrollTop,
  ).toBe(120);
});

it("shows a legacy history notice and deduplicates a final report", async () => {
  const block = agent();
  block.tool!.status = "completed";
  block.tool!.detail = "Final report";
  block.agentRun = {
    name: "root",
    steps: [{ id: "reply", kind: "message", text: "Final report" }],
  };
  act(() =>
    root.render(
      createElement(MobileAgentSheet, {
        open: true,
        onExited: () => {},
        blocks: [block],
        blockId: "root",
        onClose: () => {},
      }),
    ),
  );
  expect(page().textContent).toContain(
    "Historical subagent records may be incomplete",
  );
  expect(page().textContent?.match(/Final report/g)).toHaveLength(1);
});

it("opens an activity agent in the same sheet and restores the activity scroll", async () => {
  const block = agent();
  block.agentRun!.transcript = [
    { id: "reply", role: "assistant", text: "Child conversation" },
  ];
  function Activity() {
    const [selected, select] = useState<Block>();
    return createElement(MobileActivitySheet, {
      steps: [block],
      sessionBlocks: [block],
      live: true,
      selectedAgent: selected,
      onStep: select,
      onBack: () => select(undefined),
      onClose: () => {},
    });
  }
  act(() => root.render(createElement(Activity)));
  const scroll = page().querySelector<HTMLElement>(
    "[data-mobile-page-scroll]",
  )!;
  act(() => {
    scroll.scrollTop = 84;
    scroll.dispatchEvent(new Event("scroll"));
  });
  click(
    page().querySelector<HTMLButtonElement>(".mobile-activity-step button")!,
  );
  await finish();
  expect(page().textContent).toContain("Child conversation");
  expect(app.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  click(button("Back"));
  await finish();
  expect(
    page().querySelector<HTMLElement>("[data-mobile-page-scroll]")!.scrollTop,
  ).toBe(84);
});

it("slides new tool and thought entries into an open activity sheet without replaying its history", async () => {
  const entries = () => [...page().querySelectorAll<HTMLElement>("li[data-transcript-content-motion]")];
  const history: Block = { id: "old", role: "assistant", text: "Existing activity" };
  const render = (steps: Block[]) => act(() => root.render(createElement(MobileActivitySheet, {
    steps, live: true, onStep: () => {}, onBack: () => {}, onClose: () => {},
  })));
  render([history]);
  const oldEntry = entries()[0];
  expect(oldEntry.style.opacity).toBe("1");
  await advanceMotionTimers(600);
  const added: Block[] = [
    { id: "thought", role: "reasoning", text: "Thinking about the next step" },
    { id: "tool", role: "tool", text: "Read file", tool: { kind: "read", status: "in_progress" } },
  ];
  render([history, ...added]);
  const arriving = entries().slice(1);
  expect(arriving).toHaveLength(2);
  expect(arriving.map((entry) => entry.style.opacity)).toEqual(["0", "0"]);
  expect(page().textContent).toContain("Thinking about the next step");
  await advanceMotionTimers(200);
  expect(arriving.every((entry) => entry.style.opacity === "1")).toBe(true);
  render([history, { ...added[0], text: "Updated thought" }, added[1]]);
  expect(entries()).toEqual([oldEntry, ...arriving]);
  expect(arriving.every((entry) => entry.style.opacity === "1")).toBe(true);
});
