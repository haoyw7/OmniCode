import { expect, it } from "vitest";
import {
  BOT_CONTINUATION_MS,
  canContinueBotTask,
} from "../../../src/integrations/harness/core/botAutonomy";
import { detectBotRouting, enforceBotRouting } from "./routing";

it.each([
  ["接着上次那个继续，补上测试", "reuse-last"],
  ["继续刚才的", "reuse-last"],
  ["修复错误，接着上个继续。", "reuse-last"],
  ["这事儿单独开一条，做登录", "new"],
  ["新开一个", "new"],
  ["修复登录，另起一条！", "new"],
  ["Start a new task: fix login", "new"],
  ["Fix login, continue the last task.", "reuse-last"],
  ["新开一个，还是继续刚才的", "reuse-last"],
  ["不要新开一个", undefined],
  ["文档里的“新开一个”是一句示例", undefined],
  ["> 新开一个\n\n改颜色", undefined],
  ["> 提交结果\n\n接着上个继续", "reuse-last"],
  ["restart a new task", undefined],
])("recognizes only explicit user edge directives: %s", (text, expected) => {
  expect(detectBotRouting(text)).toBe(expected);
});

it("enforces frozen continuation and new-task provenance", () => {
  const reuse = {
    id: "w",
    routing: "reuse-last" as const,
    routingSessionId: "last",
  };
  expect(() =>
    enforceBotRouting(reuse, "sessions.create", undefined, []),
  ).toThrow("reuse-required");
  expect(() => enforceBotRouting(reuse, "sessions.steer", "other", [])).toThrow(
    "reuse-required",
  );
  expect(() =>
    enforceBotRouting(reuse, "sessions.send", "last", []),
  ).not.toThrow();
  expect(() =>
    enforceBotRouting(
      { id: "w", routing: "reuse-last" },
      "sessions.create",
      undefined,
      [],
    ),
  ).toThrow("unavailable");
  const fresh = { id: "w", routing: "new" as const };
  expect(() => enforceBotRouting(fresh, "sessions.send", "last", [])).toThrow(
    "new-required",
  );
  expect(() =>
    enforceBotRouting(fresh, "sessions.send", "new", [
      {
        id: "a",
        action: "sessions.create",
        origin: { wakeupId: "w" },
        state: "completed",
        targetRef: { environmentId: "h", projectId: "p", sessionId: "new" },
      },
    ]),
  ).not.toThrow();
});

it("uses one hour for continuation, independently of active or unavailable state", () => {
  expect(BOT_CONTINUATION_MS).toBe(3_600_000);
  expect(
    canContinueBotTask({ status: "completed", activityAt: 0 }, 3_600_000),
  ).toBe(true);
  expect(
    canContinueBotTask({ status: "completed", activityAt: 0 }, 3_600_001),
  ).toBe(false);
  expect(
    canContinueBotTask({ status: "running", activityAt: 0 }, 7_200_000),
  ).toBe(true);
  expect(canContinueBotTask({ status: "unavailable", activityAt: 0 }, 1)).toBe(
    false,
  );
});
