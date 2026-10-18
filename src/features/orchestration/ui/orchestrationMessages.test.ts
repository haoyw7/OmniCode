import { expect, it } from "vitest";
import { translate } from "../../../shared/i18n/language";
import { localizeOrchestrationMessage } from "./orchestrationMessages";
const t = (text: string, values?: Record<string, string | number>) =>
  translate(text, values, "zh-CN");
it("localizes Host conflicts while keeping unknown provider error values", () => {
  expect(
    localizeOrchestrationMessage(
      "Host rejected request: The proposal changed in another client. Refresh before editing or confirming.",
      t,
    ),
  ).toBe("Host 拒绝了请求：另一客户端已修改此提案。请刷新后再编辑或确认。");
  expect(
    localizeOrchestrationMessage("Retained worker requires review: Retry", t),
  ).toBe("保留的工作智能体需要审查：Retry");
  expect(localizeOrchestrationMessage("Error: Retry", t)).toBe("Error: Retry");
});
