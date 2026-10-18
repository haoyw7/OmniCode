import { expect, it } from "vitest";
import { harnessUpdateError } from "./harnessUpdateErrors";

it("translates rollback status without changing provider diagnostics or recovery paths", () => {
  expect(harnessUpdateError("npm ERR! Missing @openai/codex-win32-x64\nPrevious CLI installation restored (0.162.0).", "zh-CN"))
    .toBe("npm ERR! Missing @openai/codex-win32-x64\n已恢复原来的 CLI 安装（0.162.0）。");
  expect(harnessUpdateError("Rollback failed: EPERM\nRecovery files retained at C:\\Users\\wy\\backup", "zh-CN"))
    .toBe("回滚失败：EPERM\n恢复文件已保留在 C:\\Users\\wy\\backup");
});
