// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import codexIcon from "../assets/providers/codex.svg";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { MobileArchive } from "./MobileArchive";

const projects: HostProject[] = [
  { id: "one", name: "alpha", cwd: "/alpha" },
  { id: "two", name: "beta", cwd: "/beta" },
];
const session = (
  id: string,
  projectId: string,
  extra: Partial<HostSessionSummary> = {},
): HostSessionSummary => ({
  id,
  projectId,
  updatedAt: 10,
  title: id,
  harness: "codex",
  status: "idle",
  revision: 1,
  ...extra,
});
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("lists only archived conversations and drops a restored one", async () => {
  const loadSessions = async (projectId: string) =>
    projectId === "one"
      ? [
          session("live", projectId),
          session("old", projectId, { archived: true, title: "codex · old" }),
        ]
      : [session("other", projectId)];
  const onRestore = vi.fn(async () => {});
  await act(async () =>
    root.render(
      createElement(MobileArchive, {
        projects,
        disabled: false,
        loadSessions,
        onRestore,
      }),
    ),
  );

  expect(node.textContent).toContain("alpha");
  expect(node.textContent).not.toContain("beta");
  expect(node.textContent).not.toContain("live");
  expect(node.querySelector(".mobile-archive-title")?.textContent).toBe("old");
  expect(
    node.querySelector(".mobile-settings-icon img")?.getAttribute("src"),
  ).toBe(codexIcon);
  const restore = node.querySelector<HTMLButtonElement>(
    'button[aria-label="Restore old"]',
  )!;
  await act(async () => restore.click());

  expect(onRestore).toHaveBeenCalledWith(
    expect.objectContaining({ id: "old", projectId: "one", title: "codex · old" }),
  );
  expect(node.textContent).toContain("No archived conversations");
});

it("keeps the row when restoring fails", async () => {
  await act(async () =>
    root.render(
      createElement(MobileArchive, {
        projects,
        disabled: false,
        loadSessions: async (projectId: string) =>
          projectId === "one"
            ? [session("old", projectId, { archived: true })]
            : [],
        onRestore: async () => {
          throw new Error("offline");
        },
      }),
    ),
  );
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('button[aria-label="Restore old"]')!
      .click(),
  );

  expect(node.querySelector('button[aria-label="Restore old"]')).not.toBeNull();
  expect(node.textContent).toContain("Unable to restore the conversation.");
});
