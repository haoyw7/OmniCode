// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, ContextUsage } from "../../../contracts/session";
import { SessionHeaderActionsContext, type SessionHeaderActions } from "../../workspace/model/SessionHeaderActions";
import { railFits, SessionStatusPanel } from "./SessionStatusPanel";
import { setUiLanguage } from "../../../shared/i18n/language";

import { loadStatusCardOrder, saveStatusCardOrder, saveStatusCardsVisible, STATUS_CARD_IDS } from "../model/statusCardOrder";
import { useRemoteMachines } from "../../connections/model/connections";
import { configureSharedHost } from "../../connections/model/remoteProjects";

vi.mock("../../connections/model/connections", () => ({
  useRemoteMachines: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

const tasks: Block = {
  id: "tasks",
  role: "tasks",
  text: "",
  taskList: {
    items: [
      { text: "Ship", status: "completed" },
      { text: "Verify the capsule", status: "in_progress" },
    ],
  },
};
const agent: Block = {
  id: "agent",
  role: "tool",
  text: "Review the diff",
  tool: { callId: "agent", kind: "Agent", status: "in_progress" },
  agentRun: {
    name: "Review the diff",
    model: "review-model",
    steps: [],
    transcript: [
      { id: "ask", role: "user", text: "Look at the capsule." },
      { id: "reply", role: "assistant", text: "Checking compatibility." },
      {
        id: "nested",
        role: "tool",
        text: "Nested reviewer",
        tool: { callId: "nested", kind: "Agent", status: "in_progress" },
        agentRun: {
          name: "Nested reviewer",
          steps: [],
          transcript: [
            { id: "nested-reply", role: "assistant", text: "Nested record." },
          ],
        },
      },
    ],
  },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.mocked(useRemoteMachines).mockReturnValue({ machines: [], loaded: false });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setUiLanguage("en");
  vi.unstubAllGlobals();
  configureSharedHost(undefined, []);
});

let resize: ResizeObserverCallback | undefined;
const emit = (width: number) => act(() => resize!([
  { target: host, borderBoxSize: [{ inlineSize: width, blockSize: 800 }] } as unknown as ResizeObserverEntry,
], {} as ResizeObserver));

function render(blocks: Block[] = [tasks, agent], busy = true, width = 1600,
  context: ContextUsage = { used: 46_000, window: 200_000 }) {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { if (target === host) resize = this.callback; }
    disconnect() {}
  });
  const openAgent = vi.fn();
  const toggleChanges = vi.fn();
  const actions: SessionHeaderActions = {
    rename: vi.fn(),
    archive: vi.fn(),
    splitRight: vi.fn(),
    terminalAvailable: false,
    toggleTerminal: vi.fn(),
    changesOpen: false,
    toggleChanges,
  };
  const scope = createRef<HTMLDivElement>();
  scope.current = host;
  const update = (nextBlocks = blocks) => act(() => {
    root.render(
      createElement(
        SessionHeaderActionsContext.Provider,
        { value: actions },
        createElement(SessionStatusPanel, {
          blocks: nextBlocks,
          busy,
          git: { additions: 3, deletions: 1, files: 2, branch: "master" },
          cwd: "D:/A-Projects/omnicode",
          branch: "master",
          context,
          scope,
          onNavigate: vi.fn(),
          onOpenAgent: openAgent,
        }),
      ),
    );
  });
  update();
  emit(width);
  return { toggleChanges, openAgent, update };
}

const rail = () => host.querySelector<HTMLElement>("[data-session-status]");
const cardToggle = (title: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("[data-status-card] button[aria-expanded]")]
    .find((button) => button.querySelector("h3")?.textContent === title)!;
const card = () => host.querySelector<HTMLElement>("[data-subagent-card]");

describe("session status rail", () => {
  it("opens background task history, expands multiple outputs and clears only finished panel rows", () => {
    const blocks: Block[] = [
      { id: "done", role: "tool", text: "Build Windows installer", tool: { kind: "execute", status: "completed", background: true,
        preview: { kind: "shell", title: "npm run build:windows", output: "exit=1\n[exited with code 0]" } } },
      { id: "running", role: "tool", text: "Rebuild Windows installer", streaming: true, tool: { kind: "execute", status: "in_progress", background: true,
        preview: { kind: "shell", title: "npm run build:windows -- --release" } } },
    ];
    const { update } = render(blocks);
    const summary = host.querySelector('[data-status-card="background"]')!;
    expect(summary.textContent).toContain("1 finished");
    act(() => [...summary.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("1 finished"))!.click());
    const panel = host.querySelector<HTMLElement>("[data-background-tasks-panel]")!;
    const toggle = (name: string) => [...panel.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.title === name)!;
    act(() => toggle("Build Windows installer").click());
    act(() => toggle("Rebuild Windows installer").click());
    expect(panel.textContent).toContain("$ npm run build:windows");
    expect(panel.textContent).toContain("exit=1");
    expect(panel.textContent).toContain("Waiting for output…");
    act(() => panel.querySelector<HTMLButtonElement>('[aria-label="Expand panel"]')!.click());
    expect(panel.hasAttribute("data-wide")).toBe(true);
    act(() => panel.querySelector<HTMLButtonElement>('[aria-label="Clear finished tasks"]')!.click());
    expect(panel.querySelector('[data-background-task="done"]')).toBeNull();
    expect(panel.querySelector('[data-background-task="running"]')).not.toBeNull();
    expect(blocks).toHaveLength(2);
    update([...blocks, { id: "new-done", role: "tool", text: "New result", tool: { background: true, status: "completed" } }]);
    expect(panel.textContent).toContain("New result");
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector("[data-background-tasks-panel]")?.hasAttribute("inert") ?? true).toBe(true);
  });

  it("keeps background task history reachable when the conversation is too narrow for status cards", () => {
    render([{ id: "background", role: "tool", text: "Finished command", tool: { background: true, status: "completed" } }], false, 600);
    const compact = host.querySelector('[data-background-tasks-compact]')!;
    expect(compact.textContent).toContain("1 finished");
    act(() => compact.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector('[data-background-tasks-panel]')?.textContent).toContain("Finished command");
    act(() => saveStatusCardsVisible(false));
    expect(compact.hasAttribute("inert")).toBe(true);
    expect(host.querySelector('[data-background-tasks-panel]')?.hasAttribute("inert") ?? true).toBe(true);
    act(() => saveStatusCardsVisible(true));
  });

  it("adds the local computer name when machine metadata arrives and preserves it when localized", () => {
    configureSharedHost("local-environment", [], "local-machine");
    const { update } = render([], false);
    const environment = host.querySelector('[data-status-card="environment"]')!;
    expect(environment.textContent).toContain("This machine");
    expect(environment.textContent).not.toContain("wy-ubuntu");
    vi.mocked(useRemoteMachines).mockReturnValue({ loaded: true, machines: [
      { id: "other-machine", environmentId: "other-environment", name: "Other PC", endpoint: "http://other:3774" },
      { id: "local-machine", environmentId: "local-environment", name: "wy-ubuntu", endpoint: "http://127.0.0.1:3774" },
    ] });
    update();
    expect(environment.textContent).toContain("This machine · wy-ubuntu");
    expect(environment.textContent).not.toContain("Other PC");
    act(() => setUiLanguage("zh-CN"));
    expect(environment.textContent).toContain("本机 · wy-ubuntu");
    expect(environment.querySelector('[title="本机 · wy-ubuntu"]')).not.toBeNull();
  });

  it("reveals category accounting and deferred MCP tools inside the existing Context card", () => {
    render([], false, 1600, { used: 1000, window: 10000, breakdown: {
      used: 1000, window: 10000, updatedAt: Date.now(), estimated: true,
      categories: [{ name: "Messages", tokens: 1000, kind: "used" },
        { name: "MCP tools (deferred)", tokens: 5000, kind: "deferred" }],
      toolResultTokens: 600,
      tools: [{ name: "mcp__demo__read", group: "mcp", tokens: 5000, deferred: true }],
    } });
    const toggle = cardToggle("Context");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click());
    const context = host.querySelector('[data-status-card="context"]')!;
    expect(context.textContent).toContain("Tool results");
    expect(context.textContent).toContain("600");
    expect(context.textContent).toContain("6.0%");
    expect(context.textContent).not.toContain("mcp__demo__read");
    act(() => context.querySelector<HTMLButtonElement>('.context-breakdown-toggle')!.click());
    expect(context.textContent).toContain("mcp__demo__read");
    expect(context.querySelector('.context-breakdown-tool-list [data-deferred] .context-breakdown-percent')?.textContent).toBe("—");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
  it("marks the pane while the cards fit and hides them at the conversation minimum width", () => {
    // 268px of cards plus a 24px gap beside the 420px minimum.
    expect(railFits(712)).toBe(true);
    expect(railFits(711)).toBe(false);
    expect(railFits(812, 520)).toBe(true);
    expect(railFits(811, 520)).toBe(false);
    const measure = vi.spyOn(host, "getBoundingClientRect");
    render([tasks], true, 600);
    measure.mockClear();
    expect(rail()).toBeNull();
    expect(host.hasAttribute("data-status-rail")).toBe(false);
    emit(1600);
    expect(rail()).not.toBeNull();
    expect(host.hasAttribute("data-status-rail")).toBe(true);
    emit(711);
    expect(host.hasAttribute("data-status-rail")).toBe(false);
    expect(rail() === null || rail()!.hasAttribute("inert")).toBe(true);
    emit(900);
    act(() => root.unmount());
    expect(host.hasAttribute("data-status-rail")).toBe(false);
    root = createRoot(host);
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  it("lists environment, changes, tasks and context as cards", () => {
    const { toggleChanges } = render();
    const text = rail()?.textContent ?? "";
    expect(text).toContain("This machine");
    expect(text).toContain("omnicode");
    expect(text).toContain("D:/A-Projects");
    expect(text).toContain("master");
    expect(text).toContain("+3");
    expect(text).toContain("−1");
    expect(text).toContain("Verify the capsule");
    expect(text).toContain("23%");
    expect(cardToggle("Context").getAttribute("aria-expanded")).toBe("false");
    act(() => host.querySelector<HTMLButtonElement>('[title="Review changes"]')?.click());
    expect(toggleChanges).toHaveBeenCalledOnce();
    const environment = cardToggle("Environment");
    expect(environment.textContent).not.toContain("omnicode");
    act(() => environment.click());
    expect(environment.textContent).toContain("omnicode");
    act(() => environment.click());
  });

  it("hides the cards and recenters the conversation while the toolbar turns them off", () => {
    render();
    expect(rail()).not.toBeNull();
    act(() => saveStatusCardsVisible(false));
    expect(host.hasAttribute("data-status-rail")).toBe(false);
    expect(rail() === null || rail()!.hasAttribute("inert")).toBe(true);
    act(() => saveStatusCardsVisible(true));
    emit(1600);
    expect(host.hasAttribute("data-status-rail")).toBe(true);
    expect(rail()).not.toBeNull();
  });

  it("orders cards by the saved order and offers a drag handle on each", () => {
    saveStatusCardOrder(["context", "tasks", "bogus" as never, "environment"]);
    expect(loadStatusCardOrder().slice(0, 4)).toEqual(["context", "tasks", "environment", "changes"]);
    render();
    const ids = [...host.querySelectorAll<HTMLElement>("[data-status-card]")].map((card) => card.dataset.statusCard);
    expect(ids).toEqual(["context", "tasks", "environment", "changes", "subagents"]);
    expect(host.querySelectorAll("[data-status-card-handle]")).toHaveLength(5);
    saveStatusCardOrder([...STATUS_CARD_IDS]);
  });

  it("folds a card in both directions and keeps the choice", () => {
    vi.useFakeTimers();
    render([agent, { ...agent, id: "second" }]);
    const toggle = cardToggle("2 subagents");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    act(() => setUiLanguage("zh-CN"));
    expect(toggle.textContent).toContain("2 个子智能体");
    const section = toggle.closest("section")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(section.querySelector('[data-fold-state="closing"][inert]')?.textContent).toContain("Review the diff");
    act(() => toggle.click());
    act(() => vi.advanceTimersByTime(400));
    expect(section.querySelector('[data-fold-state="open"]')?.hasAttribute("inert")).toBe(false);
    act(() => toggle.click());
    act(() => vi.advanceTimersByTime(400));
    expect(section.textContent).not.toContain("Review the diff");
    act(() => root.unmount());
    root = createRoot(host);
    const { openAgent } = render([agent, { ...agent, id: "second" }]);
    expect(cardToggle("2 个子智能体").getAttribute("aria-expanded")).toBe("false");
    act(() => cardToggle("2 个子智能体").click());
    act(() => vi.advanceTimersByTime(400));
    act(() => host.querySelector<HTMLButtonElement>('[title="打开子智能体会话"]')?.click());
    expect(openAgent).toHaveBeenCalled();
  });

  it("opens subagents as their own conversation and follows their steps", () => {
    const { openAgent, update } = render();
    const agentRow = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Review the diff"));
    act(() => agentRow?.click());
    expect(openAgent).toHaveBeenCalledWith(agent);
    expect(agentRow?.textContent).toContain("1 step");
    const updatedAgent = { ...agent, agentRun: { ...agent.agentRun!, transcript: [
      ...agent.agentRun!.transcript!,
      { id: "next-tool", role: "tool" as const, text: "Run tests" },
    ] } };
    update([tasks, updatedAgent]);
    expect(agentRow?.textContent).toContain("2 steps");
    expect(card()).toBeNull();
    expect(host.textContent).not.toContain("Checking compatibility.");
    expect(host.textContent).not.toContain("Look at the capsule.");
  });

  it("keeps completed and failed agents available after the parent becomes idle", () => {
    const completed = {
      ...agent,
      tool: { ...agent.tool, status: "completed" },
    };
    const failed = {
      ...agent,
      id: "failed",
      agentRun: { ...agent.agentRun!, name: "Failed reviewer" },
      tool: { ...agent.tool, status: "failed" },
    };
    const { openAgent } = render([completed, failed], false);
    expect(host.querySelector('[title="Completed"]')).not.toBeNull();
    expect(host.querySelector('[title="Failed"]')).not.toBeNull();
    const rows = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[title="Open subagent conversation"]',
      ),
    ];
    expect(rows).toHaveLength(2);
    act(() => rows.find((row) => row.textContent?.includes("Failed reviewer"))?.click());
    expect(openAgent).toHaveBeenCalledWith(failed);
  });
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
