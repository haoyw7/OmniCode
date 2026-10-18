// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  appendWorktreeCreationLog,
  completeWorktreeCreation,
  failWorktreeCreation,
  foldWorktreeCreation,
  startWorktreeCreation,
} from "../../source-control/model/worktreeCreation";
import { WorktreeCreationCard } from "./WorktreeCreationCard";

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

async function render(creation: Parameters<typeof WorktreeCreationCard>[0]["creation"]) {
  await act(async () => {
    root.render(createElement(WorktreeCreationCard, { creation }));
  });
}

it("shows Git's progress lines verbatim while the worktree is being created", async () => {
  const creation = appendWorktreeCreationLog(
    startWorktreeCreation("main", "run-1"),
    "run-1",
    "Preparing worktree (new branch 'mc/3f2a1b7c')",
  );
  await render(creation);
  expect(container.textContent).toContain("Creating worktree…");
  expect(container.textContent).toContain("[info] Starting worktree creation");
  expect(container.textContent).toContain(
    "Preparing worktree (new branch 'mc/3f2a1b7c')",
  );
});

it("keeps a finished creation's log open until it folds away", async () => {
  const creation = completeWorktreeCreation(
    startWorktreeCreation("main", "run-1"),
    "run-1",
    "/trees/mc-3f2a1b7c",
  );
  await render(creation);
  expect(container.textContent).toContain("Worktree created");
  expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  await render(foldWorktreeCreation(creation, "run-1"));
  expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull();
});

it("lets a folded creation's log be reopened", async () => {
  const creation = foldWorktreeCreation(
    completeWorktreeCreation(
      startWorktreeCreation("main", "run-1"),
      "run-1",
      "/trees/mc-3f2a1b7c",
    ),
    "run-1",
  );
  await render(creation);
  const header = container.querySelector<HTMLButtonElement>(
    'button[aria-expanded="false"]',
  );
  await act(async () => header!.click());
  expect(
    container.querySelector('button[aria-expanded="true"]'),
  ).not.toBeNull();
  expect(container.textContent).toContain(
    "Worktree created at /trees/mc-3f2a1b7c",
  );
});

it("keeps a failed creation's error open in its log", async () => {
  const creation = failWorktreeCreation(
    startWorktreeCreation("main", "run-1"),
    "run-1",
    "fatal: a branch named 'mc/x' already exists",
  );
  await render(creation);
  expect(container.textContent).toContain("Worktree creation failed");
  expect(container.textContent).toContain(
    "[error] fatal: a branch named 'mc/x' already exists",
  );
});
