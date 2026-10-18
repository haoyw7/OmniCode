import { expect, it, vi } from "vitest";
import {
  availableWorktreeBranch,
  generateWorktreeBranch,
  WORKTREE_NAME_ERROR,
} from "./worktreeNaming";

it("uses the configured model's semantic name before trying a provider", async () => {
  const provider = vi.fn(async () => "ignored");
  expect(
    await generateWorktreeBranch([
      async () => "monocode/Fix Login Redirect",
      provider,
    ]),
  ).toBe("mc/fix-login-redirect");
  expect(provider).not.toHaveBeenCalled();
});

it("falls back to the provider after model failure or an unusable name", async () => {
  expect(
    await generateWorktreeBranch([
      async () => {
        throw new Error("Offline");
      },
      async () => "修复登录",
      async () => "fix/login",
    ]),
  ).toBe("mc/fix-login");
  await expect(generateWorktreeBranch([async () => null])).rejects.toThrow(
    WORKTREE_NAME_ERROR,
  );
});

it("keeps descriptive names unique against branches and worktree directory names", () => {
  expect(
    availableWorktreeBranch(
      "mc/fix-login",
      ["mc/fix-login", "mc/fix-login-2/nested"],
      ["C:\\trees\\wt-mc-fix-login-3", "/trees/mc-fix-login-4"],
    ),
  ).toBe("mc/fix-login-5");
});
