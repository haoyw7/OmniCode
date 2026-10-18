// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
}));

vi.mock("../../connections/files/model/fileIndex", () => ({
  peekProjectFiles: () => [],
  loadProjectFiles: async () => [],
  recentOpenedFiles: () => [],
  rankProjectFiles: () => [],
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  searchSessions: vi.fn(async () => ({ hits: [], truncated: false })),
  cancelSessionSearch: vi.fn(async () => {}),
}));
vi.mock("../model/search", () => ({
  searchProject: vi.fn(async () => ({ matches: [], truncated: false })),
  cancelProjectSearch: vi.fn(async () => {}),
}));

let root: Root;
let container: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onClose = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(
  open: boolean,
  props: Partial<ComponentProps<typeof SearchView>> = {},
) {
  await act(async () =>
    root.render(
      createElement(SearchView, {
        open,
        cwd: "/repo",
        recents: [{ path: "/work/monocode", openedAt: 1 }],
        history: [],
        sessions: [],
        onClose,
        onOpenFile: vi.fn(),
        onOpenSession: vi.fn(),
        onOpenProject: vi.fn(),
        ...props,
      }),
    ),
  );
}

it("retains the query, scope and results when focus leaves and returns", async () => {
  const queryRequest = { query: "work", token: 1 };
  await render(true, { queryRequest });
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search"]',
  )!;
  const projects = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent === "Projects")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "monocode");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    projects.click();
    await vi.advanceTimersByTimeAsync(300);
  });

  await render(false, { queryRequest });
  expect(container.querySelector("[data-app-search]")).not.toBeNull();
  expect(input.value).toBe("monocode");
  expect(projects.getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("monocode");

  await render(true, { queryRequest });
  expect(input.value).toBe("monocode");
  expect(projects.getAttribute("aria-pressed")).toBe("true");
});

it("applies a new search request while retaining the mounted view", async () => {
  await render(false);
  await render(true, { queryRequest: { query: "new query", token: 2 } });
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Search"]')
      ?.value,
  ).toBe("new query");
});

it("only leaves Search on Escape while its workspace pane is active", async () => {
  await render(false);
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  await render(true);
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
