import { expect, it, vi } from "vitest";
import {
  availableWorktreeBranch,
  generateWorktreeBranch,
  WORKTREE_NAME_ERROR,
} from "./worktreeNaming";

it.each(["oc", "mc", "omnicode"])("normalizes the %s prefix without duplicating it", async (prefix) => {
  expect(await generateWorktreeBranch([async () => `${prefix}/fix-login`])).toBe("oc/fix-login");
});

it("uses the configured model's semantic name before trying a provider", async () => {
  const provider = vi.fn(async () => "ignored");
  expect(
    await generateWorktreeBranch([
      async () => "omnicode/Fix Login Redirect",
      provider,
    ]),
  ).toBe("oc/fix-login-redirect");
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
  ).toBe("oc/fix-login");
  await expect(generateWorktreeBranch([async () => null])).rejects.toThrow(
    WORKTREE_NAME_ERROR,
  );
});

it("keeps descriptive names unique against branches and worktree directory names", () => {
  expect(
    availableWorktreeBranch(
      "oc/fix-login",
      ["oc/fix-login", "oc/fix-login-2/nested"],
      ["C:\\trees\\wt-oc-fix-login-3", "/trees/oc-fix-login-4"],
    ),
  ).toBe("oc/fix-login-5");
});
