import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SessionWorktreeIcon } from "../../../shared/ui/SessionWorktreeIcon";

it("requires Git confirmation even when old history contains a worktree directory", () => {
  for (const linkedWorktree of [undefined, false]) {
    expect(renderToStaticMarkup(createElement(SessionWorktreeIcon, {
      session: { cwd: "D:\\repo", executionCwd: "D:/repo", linkedWorktree },
    }))).toBe("");
  }
});

it("shows a confirmed linked worktree opened as its own project, but hides removed worktrees", () => {
  const session = { cwd: "/repo-linked", linkedWorktree: true };
  expect(renderToStaticMarkup(createElement(SessionWorktreeIcon, { session }))).toContain("/repo-linked");
  expect(renderToStaticMarkup(createElement(SessionWorktreeIcon, {
    session: { ...session, worktreeRemoved: true },
  }))).toBe("");
});
