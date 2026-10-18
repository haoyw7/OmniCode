// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../model/projectGroups";
import { savePinnedProjects } from "../model/recents";
import { ProjectList } from "../../../app/shell/ProjectList";
import { useProjectDiffStats } from "../../source-control/hooks/useProjectDiffStats";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(useProjectDiffStats).mockClear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderRail(compact = false) {
  await act(async () =>
    root.render(
      createElement(ProjectList, {
        compact,
        cwd: "/work/personal",
        recents: [
          { path: "/work/client", openedAt: 1 },
          { path: "/work/personal", openedAt: 2 },
        ],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
}

it("keeps project Git stats in the project pop-out and suspends them for avatars", async () => {
  await renderRail();
  expect(vi.mocked(useProjectDiffStats).mock.calls.some(([, enabled]) => enabled)).toBe(true);

  vi.mocked(useProjectDiffStats).mockClear();
  await renderRail(true);
  expect(vi.mocked(useProjectDiffStats).mock.calls.length).toBeGreaterThan(0);
  expect(vi.mocked(useProjectDiffStats).mock.calls.every(([, enabled]) => !enabled)).toBe(true);
  expect(container.querySelector('[data-project-list="avatars"]')).not.toBeNull();
});

function button(label: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) =>
      !item.closest("[inert]") && (item.getAttribute("aria-label") === label || item.textContent === label),
  );
  expect(found, label).toBeDefined();
  return found!;
}

function sectionLabels(): string[] {
  return [...container.querySelectorAll("span")]
    .map((element) => element.textContent ?? "")
    .filter((text) => ["Pinned", "Groups", "Projects"].includes(text));
}

it("creates, styles, assigns, and deletes a group from the project list", async () => {
  await renderRail();
  expect(sectionLabels()).toEqual(["Projects"]);
  expect(
    document.querySelector('button[aria-label="New project group"]'),
  ).toBeNull();

  const personal = button("personal");
  await act(async () => {
    personal.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 40,
      }),
    );
  });
  act(() => button("Move to group").click());
  const moveMenu = document.querySelector(
    '[role="menu"][aria-label="Move to group"]',
  )!;
  const newGroup = [...moveMenu.querySelectorAll("button")].find(
    (item) => item.textContent === "New group…",
  )!;
  act(() => newGroup.click());

  const input = document.querySelector<HTMLInputElement>(
    '[role="menu"][aria-label="Project group actions"] input[aria-label="Group name"]',
  )!;
  expect(input.value).toBe("New group");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, "Side projects");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(loadProjectGroups()[0].name).toBe("Side projects");
  const groupId = loadProjectGroups()[0].id;
  expect(loadProjectGroupAssignments()).toEqual({
    [pathKey("/work/personal")]: groupId,
  });
  expect(button("Side projects, 1 project")).toBeDefined();

  act(() => button("Side projects group options").click());
  act(() => button("Mascot Curious").click());
  expect(loadProjectGroups()[0].mascot).toBe("curious");
  act(() => button("Delete group").click());
  expect(loadProjectGroups()).toEqual([]);
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(button("personal")).toBeDefined();
  expect(sectionLabels()).toEqual(["Projects"]);
  expect(
    document.querySelector('button[aria-label="New project group"]'),
  ).toBeNull();
});
