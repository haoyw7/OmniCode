// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkflowActivityContext,
  type WorkflowActivityEntry,
} from "../../../features/workflows/model/workflowActivity";
import { SessionCard } from "./SessionCard";
import { SessionPageCountsContext, sessionPageCounts } from "./sessionPageCounts";
import { newTab, type LayoutNode } from "../../../features/workspace/model/layout";

type RunStatus = WorkflowActivityEntry["activity"]["runs"][number]["status"];
let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof SessionCard>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    session: {
      id: "session-1",
      cwd: "/workspace/project",
      harness: "omp",
      model: "",
      runtimeMode: "supervised",
      title: "Workflow conversation",
      createdAt: 1,
      updatedAt: 1,
    },
    isActive: false,
    isSelected: false,
    busy: false,
    done: true,
    unread: false,
    linkedUpdate: false,
    now: 1000,
    onSelect: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(statuses: RunStatus[] = []) {
  const entry: WorkflowActivityEntry = {
    sessionId: props.session.id,
    cwd: props.session.cwd,
    title: props.session.title,
    harness: props.session.harness,
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
    { value: new Map(statuses.length ? [[entry.sessionId, entry]] : []) },
    createElement(SessionCard, props),
  )));
  return container.querySelector<HTMLElement>("[data-session-card]")!;
}

describe("session card workflow activity", () => {
  it.each([
    { name: "default", layout: {} },
    { name: "compact", layout: { compact: true } },
    { name: "dense", layout: { dense: true } },
    { name: "two-line", layout: { dense: true, projectLabel: "Project" } },
  ])("keeps the $name row running after the parent reply ends", ({ layout }) => {
    Object.assign(props, layout, { busy: true });
    render(["running"]);
    props = { ...props, busy: false };
    const row = render(["running"]);
    expect(row.querySelectorAll(".terminal-spinner")).toHaveLength(1);
    expect(row.textContent).not.toContain("Done");
    expect(row.querySelector("[data-session-time]")).toBeNull();
  });

  it.each(["completed", "errored", "stopped"] as const)("stops when the last workflow becomes %s", (status) => {
    render(["running"]);
    // Props stay identical: the memoized card must react to context changes.
    const row = render([status]);
    expect(row.querySelector(".terminal-spinner")).toBeNull();
    expect(row.textContent).toContain("Done");
  });

  it("keeps running while another workflow is pending", () => {
    const row = render(["completed", "pending"]);
    expect(row.querySelectorAll(".terminal-spinner")).toHaveLength(1);
  });

  it.each(["approval", "input"] as const)("preserves the %s prompt ahead of running activity", (waitingFor) => {
    props.waitingFor = waitingFor;
    const row = render(["running"]);
    expect(row.querySelector(".terminal-spinner")).toBeNull();
    expect(row.textContent).toContain(waitingFor === "input" ? "Needs input" : "Need approval");
  });

  it("keeps ordinary agent activity when workflows have finished", () => {
    props.busy = true;
    expect(render(["completed"]).querySelector(".terminal-spinner")).not.toBeNull();
  });

  it("does not mark an idle conversation without workflows as running", () => {
    expect(render().querySelector(".terminal-spinner")).toBeNull();
  });
});

describe("session card hover actions", () => {
  it("puts archive before the actions menu on two-line rows", () => {
    const onArchive = vi.fn();
    Object.assign(props, { dense: true, projectLabel: "Project", onOpenMenu: vi.fn(), onArchive });
    const row = render();
    const buttons = [...row.querySelectorAll<HTMLElement>("[data-session-action-buttons] > button")];
    expect(buttons.map((button) => button.hasAttribute("data-session-archive") ? "archive" : button.hasAttribute("data-session-menu") ? "menu" : "other"))
      .toEqual(["archive", "menu"]);
    act(() => buttons[0].click());
    expect(onArchive).toHaveBeenCalledExactlyOnceWith("session-1", true);
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

describe("session card page count", () => {
  it("shows how many chats share the page under the agent icon", () => {
    const pages = sessionPageCounts([
      { ...newTab("session-1"), layout: { type: "split", id: "row", dir: "right", sizes: [0.5, 0.5], children: [{ type: "leaf", id: "session-1" }, { type: "leaf", id: "session-2" }] } as LayoutNode },
      newTab("alone"),
    ]);
    expect([...pages]).toEqual([["session-1", 2], ["session-2", 2]]);
    Object.assign(props, { dense: true, projectLabel: "Project" });
    act(() => root.render(createElement(SessionPageCountsContext.Provider, { value: pages }, createElement(SessionCard, props))));
    expect(container.querySelector("[data-session-project] [data-session-page-count]")?.textContent).toBe("2");
    act(() => root.render(createElement(SessionPageCountsContext.Provider, { value: new Map() }, createElement(SessionCard, props))));
    expect(container.querySelector("[data-session-page-count]")).toBeNull();
  });
});
