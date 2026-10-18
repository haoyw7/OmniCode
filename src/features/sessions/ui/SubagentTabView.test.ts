// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { SubagentTabView } from "./SubagentTabView";
import { SubagentTabsContext, useOpenSubagent } from "./SubagentTabsContext";
import {
  isSubagentTab,
  newSubagentTab,
  newTab,
  openEditorTab,
} from "../../workspace/model/layout";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));

const child = (status = "in_progress"): Block => ({
  id: "child",
  role: "tool",
  text: "Review auth",
  tool: { callId: "child", kind: "Agent", status },
  agentRun: {
    name: "Review auth",
    steps: [],
    transcript: [
      { id: "brief", role: "user", text: "Check authentication." },
      { id: "reply", role: "assistant", text: "Private child reply." },
      {
        id: "nested",
        role: "tool",
        text: "Nested reviewer",
        tool: {
          callId: "nested",
          kind: "Agent",
          status: "failed",
          output: "Nested failure.",
        },
        agentRun: { name: "Nested reviewer", steps: [], transcript: [] },
      },
    ],
  },
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.dataset.reducedMotion = "on";
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

function Parent({ session }: { session: Session }) {
  const onOpenAgent = useOpenSubagent(session);
  return createElement(
    "div",
    { "data-parent": "" },
    createElement(AgentTranscript, {
      blocks: session.blocks,
      busy: session.busy,
      onOpenAgent,
    }),
  );
}

function Workspace({ session }: { session: Session }) {
  const [workspace, setWorkspace] = useState(() => newTab(session.id));
  const pane = workspace.editorPanes[0];
  const file = pane?.files.find((file) => file.id === pane.activeFileId);
  return createElement(
    SubagentTabsContext.Provider,
    {
      value: (request) => {
        const { parentSessionId, path, harness, cwd, title, sourceFileId } =
          request;
        setWorkspace((current) =>
          openEditorTab(
            current,
            newSubagentTab(title, cwd, { parentSessionId, path, harness }),
            { afterFileId: sourceFileId },
          ),
        );
      },
    },
    createElement(Parent, { session }),
    createElement(
      "nav",
      {},
      pane?.files.map((file) =>
        createElement(
          "button",
          {
            key: file.id,
            role: "tab",
            "aria-selected": file.id === pane.activeFileId,
          },
          file.path,
        ),
      ),
    ),
    file && isSubagentTab(file)
      ? createElement(SubagentTabView, {
          key: file.id,
          file,
          session,
          visible: true,
        })
      : null,
  );
}

describe("subagent conversation tabs", () => {
  it.each(["in_progress", "failed"])(
    "opens %s runs outside the parent, updates live, and opens nested runs separately",
    (status) => {
      let session = {
        ...newSession("codex", "/repo"),
        busy: true,
        blocks: [child(status)],
      };
      const render = () =>
        act(() => root.render(createElement(Workspace, { session })));
      render();
      const parent = host.querySelector<HTMLElement>("[data-parent]")!;
      expect(parent.textContent).not.toContain("Private child reply.");
      const open = parent.querySelector<HTMLButtonElement>(
        '[aria-label="Show Review auth\'s work"]',
      )!;
      expect(open).not.toBeNull();
      act(() => open.click());
      expect(parent.textContent).not.toContain("Private child reply.");
      expect(open.hasAttribute("aria-expanded")).toBe(false);
      expect(host.querySelector("[data-subagent-tab]")?.textContent).toContain(
        "Private child reply.",
      );
      expect(host.querySelector("[data-subagent-tab]")?.textContent).toContain(
        "Check authentication.",
      );
      act(() => open.click());
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);

      const updated = {
        ...session.blocks[0],
        agentRun: {
          ...session.blocks[0].agentRun!,
          transcript: [
            ...session.blocks[0].agentRun!.transcript!,
            {
              id: "later",
              role: "assistant" as const,
              text: "Live child update.",
            },
          ],
        },
      };
      session = { ...session, blocks: [updated] };
      render();
      expect(host.querySelector("[data-subagent-tab]")?.textContent).toContain(
        "Live child update.",
      );
      expect(parent.textContent).not.toContain("Live child update.");
      expect(
        host.querySelector("[data-subagent-tab]")?.textContent,
      ).not.toContain("Nested failure.");
      const nested = host.querySelector<HTMLButtonElement>(
        '[aria-label="Show Nested reviewer\'s work"]',
      )!;
      act(() => nested.click());
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
      expect(
        host.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      ).toBe("Nested reviewer");
      expect(host.querySelector("[data-subagent-tab]")?.textContent).toContain(
        "Nested failure.",
      );
      act(() => open.click());
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
      expect(
        host.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      ).toBe("Review auth");
    },
  );

  it("retains partial-history notices and does not duplicate a final report", () => {
    const block = child("completed");
    block.agentRun = {
      ...block.agentRun!,
      coverage: "partial",
      transcript: [{ id: "answer", role: "assistant", text: "Only once." }],
    };
    block.tool = { ...block.tool, output: "Only once." };
    const session = { ...newSession("codex", "/repo"), blocks: [block] };
    const file = newSubagentTab("Review auth", session.cwd, {
      parentSessionId: session.id,
      path: [block.id],
      harness: session.harness,
    });
    if (!isSubagentTab(file)) throw new Error("Expected a subagent tab");
    act(() =>
      root.render(
        createElement(SubagentTabView, { file, session, visible: true }),
      ),
    );
    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      "only part",
    );
    expect(host.textContent?.match(/Only once\./g)).toHaveLength(1);
    expect(host.textContent).toContain("Completed");
    act(() =>
      root.render(
        createElement(SubagentTabView, {
          file,
          session: { ...session, blocks: [] },
          visible: true,
        }),
      ),
    );
    expect(host.textContent).toContain("no longer available");
    expect(host.textContent).not.toContain("Only once.");
  });
});
