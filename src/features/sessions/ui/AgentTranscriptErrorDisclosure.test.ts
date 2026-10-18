// @vitest-environment happy-dom
import { startMotionClock, stopMotionClock, finishMotion } from "../../../../tests/helpers/sharedMotionClock";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startMotionClock();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tool error disclosure", () => {
  it("keeps grouped error output collapsed until its failed row is clicked", async () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Start the app" },
      {
        id: "command",
        role: "tool",
        text: "Run npm run dev",
        tool: {
          kind: "shell",
          status: "failed",
          detail: "Error: listen EPERM\n    at Server.setupListenHandle",
        },
      },
    ];

    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Show error details for"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Server.setupListenHandle");

    const failedRow = container.querySelector<HTMLElement>(
      '[aria-label^="Failed tool call:"]',
    );
    const message = Array.from(failedRow?.querySelectorAll("span") ?? []).find(
      (element) => element.textContent?.includes("npm run dev"),
    );
    expect(message).not.toBeNull();

    act(() => message?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Server.setupListenHandle");

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    const closing = container.querySelector('[data-fold-state="closing"]');
    expect(closing?.hasAttribute("inert")).toBe(true);
    expect(closing?.getAttribute("aria-hidden")).toBe("true");
    expect(closing?.textContent).toContain("Server.setupListenHandle");
    // Reopening during the exit retains the same detail and cancels the close.
    act(() => trigger?.click());
    expect(container.querySelector('[data-fold-state="closing"]')).toBeNull();
    expect(closing?.hasAttribute("inert")).toBe(false);
    act(() => trigger?.click());
    await act(async () => { await finishMotion(); });
    expect(container.textContent).not.toContain("Server.setupListenHandle");
  });
});

describe("tool row bodies", () => {
  it.each([
    { status: "in_progress", preview: { kind: "shell" as const, title: "echo first\necho second" } },
    { status: "running", input: "echo first\necho second" },
    { status: "pending", title: "echo first\necho second" },
    { status: "running" },
  ])("expands a running command before output arrives: %j", async (tool) => {
    const command = "echo first\necho second";
    const block: Block = {
      id: "command",
      role: "tool",
      text: tool.preview || tool.input || tool.title ? "echo first" : command,
      tool: { kind: "execute", ...tool },
    };
    act(() => root.render(createElement(AgentTranscript, {
      blocks: [{ id: "user", role: "user", text: "Run it" }, block], busy: true,
    })));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-tool-renderer="execute"] button[aria-expanded]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-tool-command]")).toBeNull();
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-tool-command]")?.textContent).toBe(command);
    expect(container.querySelector("[data-tool-output]")).toBeNull();

    act(() => trigger?.click());
    const closing = container.querySelector('[data-fold-state="closing"]');
    expect(closing?.hasAttribute("inert")).toBe(true);
    expect(closing?.textContent).toContain(command);
    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-fold-state="closing"]')).toBeNull();
    act(() => trigger?.click());
    await act(async () => { await finishMotion(); });
    expect(container.querySelector("[data-tool-command]")).toBeNull();
  });

  it("keeps the running command readable as output streams and respects a manual collapse", async () => {
    const command = "echo first\necho second";
    const render = (output?: string, status = "running") => act(() => root.render(
      createElement(AgentTranscript, {
        busy: true,
        blocks: [
          { id: "user", role: "user", text: "Run it" },
          { id: "command", role: "tool", text: "echo first", tool: {
            kind: "execute", status,
            preview: { kind: "shell", title: command, output },
          } },
        ],
      }),
    ));
    render();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-tool-renderer="execute"] button[aria-expanded]',
    );
    act(() => trigger?.click());
    render("first");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-tool-command]")?.textContent).toBe(command);
    expect(container.querySelector("[data-tool-output]")?.textContent).toBe("first");

    act(() => trigger?.click());
    await act(async () => { await finishMotion(); });
    render("first\nsecond");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-tool-output]")).toBeNull();
    act(() => trigger?.click());
    expect(container.querySelector("[data-tool-output]")?.textContent).toBe("first\nsecond");
    render("first\nsecond", "completed");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-tool-output]")?.textContent).toBe("first\nsecond");
  });

  it("opens a finished command onto its output", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check git" },
      {
        id: "git",
        role: "tool",
        text: "git status",
        tool: {
          kind: "execute",
          status: "completed",
          preview: { kind: "shell", output: "On branch main" },
        },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    expect(
      container.querySelector('[data-tool-renderer="execute"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("On branch main");
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show details for git status"]',
    );
    act(() => trigger?.click());
    expect(container.textContent).toContain("On branch main");
  });

  it("says how long a settled thought ran", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Plan it" },
      {
        id: "think",
        role: "reasoning",
        text: "Weighing the options",
        startedAt: 1_000,
        durationMs: 12_000,
      },
      {
        id: "read",
        role: "tool",
        text: "Read src/a.ts",
        tool: { kind: "read", status: "completed" },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    expect(container.textContent).toContain(
      "Thought for 12s · Weighing the options",
    );
  });
});

describe("MonoCode CLI disclosure", () => {
  it("shows a compact row without a disclosure for a successful call", () => {
    const command =
      "/repo/target/debug/MonoCode.app/Contents/MacOS/monocode app notes.list";
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/monocode list notes" },
      {
        id: "notes",
        role: "tool",
        text: command,
        tool: {
          kind: "shell",
          status: "completed",
          detail: '{"ok":true,"result":{"notes":[{"title":"Ideas"}]}}',
        },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-monocode-tool-call="notes.list"]',
    );
    expect(row?.querySelector("button")).toBeNull();
    expect(row?.querySelector("pre")).toBeNull();
    expect(row?.textContent).toContain("Ranmonocode app notes.list");
    expect(row?.querySelector('svg[data-ui="omi"]')).not.toBeNull();
    expect(row?.querySelector(".bg-content\\/6")).not.toBeNull();
    expect(container.textContent).not.toContain("Contents/MacOS/monocode");
    expect(container.textContent).not.toContain('"title":"Ideas"');
  });

  it("reveals a failed call's error when clicked", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/monocode list notes" },
      {
        id: "notes",
        role: "tool",
        text: "monocode app notes.list",
        tool: { kind: "shell", status: "failed", detail: "Connection refused" },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show error details for OmniCode: List notes"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Connection refused");

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Connection refused");
  });
});
