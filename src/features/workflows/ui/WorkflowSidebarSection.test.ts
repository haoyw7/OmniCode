// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkflowActivityContext,
  type WorkflowActivityEntry,
} from "../model/workflowActivity";
import { WorkflowSidebarSection } from "./WorkflowSidebarSection";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(statuses: WorkflowActivityEntry["activity"]["runs"][number]["status"][]) {
  const entry: WorkflowActivityEntry = {
    sessionId: "workflow-session",
    cwd: "/workspace/A-Test",
    title: "ai-hotnews-daily",
    harness: "omp",
    activity: {
      runs: statuses.map((status, index) => ({
        runId: `run-${index}`,
        status,
        phases: [],
        agentsWorking: 0,
      })),
    },
  };
  act(() => root.render(createElement(
    WorkflowActivityContext.Provider,
    { value: new Map([[entry.sessionId, entry]]) },
    createElement(WorkflowSidebarSection, {
      onOpenSession: vi.fn(),
      onOpenWorkflows: vi.fn(),
      renderHarnessIcon: () => createElement("span", { "data-test-harness": true }),
      runningIndicator: createElement(TerminalSpinner),
    }),
  )));
  return container.querySelector<HTMLElement>("[data-workflow-conversation-select]")!;
}

describe("workflow sidebar running indicator", () => {
  it.each(["pending", "running"] as const)("shows activity for a %s workflow without a busy parent agent", (status) => {
    const row = render([status]);
    expect(row.querySelector('[aria-label="Working..."] .terminal-spinner')).not.toBeNull();
    expect(row.querySelector("[data-session-avatar] [data-test-harness]")).not.toBeNull();
    expect(row.textContent).toContain("ai-hotnews-daily");
    expect(row.querySelector("[data-session-project]")?.textContent).toBe("A-Test");
  });

  it.each(["completed", "errored", "stopped"] as const)("removes activity when the last live workflow becomes %s", (status) => {
    render(["completed", "running"]);
    expect(container.querySelectorAll(".terminal-spinner")).toHaveLength(1);
    const row = render(["completed", status]);
    expect(row.querySelector(".terminal-spinner")).toBeNull();
  });

  it("keeps activity while another workflow is still live", () => {
    render(["running", "running"]);
    render(["completed", "running"]);
    expect(container.querySelectorAll(".terminal-spinner")).toHaveLength(1);
  });
});
