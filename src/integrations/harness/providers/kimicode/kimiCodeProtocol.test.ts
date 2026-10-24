import { describe, expect, it } from "vitest";
import {
  kimiConfigOptions,
  kimiMode,
  kimiPermissionOption,
  kimiQuestion,
  kimiQuestionResponse,
  kimiSettings,
  modelsFromKimiSession,
} from "./kimiCodeProtocol";

import setup from "./fixtures/session-new.json";

describe("Kimi Code ACP mappings", () => {
  it("discovers grouped models with the current model first and keeps session settings separate", () => {
    expect(modelsFromKimiSession(setup)).toEqual([
      {
        id: "kimicode:kimi-code/kimi-for-coding",
        harness: "kimicode",
        name: "Kimi Code",
        nativeId: "kimi-code/kimi-for-coding",
      },
      {
        id: "kimicode:custom/other",
        harness: "kimicode",
        name: "Custom user name",
        nativeId: "custom/other",
      },
    ]);
    expect(
      kimiSettings(
        kimiConfigOptions(setup.configOptions),
        "kimi-code/kimi-for-coding",
      ).settings,
    ).toEqual([expect.objectContaining({ id: "thinking", value: "off" })]);
    expect(modelsFromKimiSession({ configOptions: {} })).toEqual([]);
  });
  it("uses permission kinds instead of interpreting opaque option ids", () => {
    const permission = {
      options: [
        { optionId: "approve_once", kind: "allow_once" },
        { optionId: "custom-reject", kind: "reject_once" },
      ],
    };
    expect(kimiPermissionOption(permission, true)).toBe("approve_once");
    expect(kimiPermissionOption(permission, false)).toBe("custom-reject");
    expect(kimiPermissionOption({ options: [] }, true)).toBeUndefined();
    expect(kimiMode({ runtimeMode: "auto-accept-edits" })).toBe("default");
    expect(kimiMode({ runtimeMode: "full-access", intent: "plan" })).toBe(
      "plan",
    );
  });
  it("round trips full native question forms, including multi-select and user labels", () => {
    const question = kimiQuestion("elicitation/create", {
      mode: "form",
      message: "请选择",
      requestedSchema: {
        properties: {
          q0: {
            type: "string",
            title: "目标",
            oneOf: [{ const: "桌面", title: "桌面" }],
          },
          q1: {
            type: "array",
            title: "平台",
            items: {
              anyOf: [
                { const: "win", title: "Windows" },
                { const: "linux", title: "Linux" },
              ],
            },
          },
        },
      },
    })!;
    expect(question.questions[1].multiSelect).toBe(true);
    expect(
      kimiQuestionResponse(question, {
        kind: "answered",
        answers: { q0: ["桌面"], q1: ["linux", "win", "unknown"] },
      }),
    ).toEqual({
      action: "accept",
      content: { q0: "桌面", q1: ["linux", "win"] },
    });
    expect(kimiQuestionResponse(question, { kind: "skipped" })).toEqual({
      action: "decline",
    });
  });
  it("recognizes question permission fallbacks without confusing them with approvals", () => {
    const question = kimiQuestion("session/request_permission", {
      toolCall: {
        title: "AskUserQuestion",
        content: [
          { type: "content", content: { type: "text", text: "Pick a branch" } },
        ],
      },
      options: [
        { optionId: "q0_opt_0", name: "main", kind: "allow_once" },
        { optionId: "q0_skip", name: "Skip", kind: "reject_once" },
      ],
    })!;
    expect(question.questions[0].prompt).toBe("Pick a branch");
    expect(
      kimiQuestionResponse(question, {
        kind: "answered",
        answers: { q0: ["q0_opt_0"] },
      }),
    ).toEqual({ outcome: { outcome: "selected", optionId: "q0_opt_0" } });
    expect(
      kimiQuestion("session/request_permission", {
        options: [{ optionId: "approve_once", kind: "allow_once" }],
      }),
    ).toBeNull();
  });
});
