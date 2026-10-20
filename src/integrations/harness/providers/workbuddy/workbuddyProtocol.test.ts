import { describe, expect, it } from "vitest";
import { control, isHistorical, permissionMode, permissionResponse, questionInput, questions, spawnArgs, userMessage, workBuddyModel } from "./workbuddyProtocol";
import type { SendTurnInput } from "../../core/types";

const input: SendTurnInput = { sessionId: "thread", cwd: "/project", model: "workbuddy:cn:auto", runtimeMode: "supervised", text: "hello", onEvent() {} };
describe("WorkBuddy 2.161 stream-json protocol", () => {
  it("keeps regions and native model identities separate", () => {
    expect(workBuddyModel("workbuddy:cn:auto")).toEqual({ edition: "cn", nativeId: "auto" });
    expect(workBuddyModel("workbuddy:global:fast-model")).toEqual({ edition: "global", nativeId: "fast-model" });
    expect(() => workBuddyModel("fast-model")).toThrow();
    expect(spawnArgs(input, "native-id")).toEqual(expect.arrayContaining(["--resume", "native-id", "--permission-mode", "default"]));
    expect(spawnArgs(input)).not.toContain("--permission-prompt-tool");
    expect(spawnArgs(input)).not.toContain("--max-turns");
  });
  it("maps permissions without silently widening supervised or plan mode", () => {
    expect(["supervised", "auto-accept-edits", "auto", "full-access"].map(mode => permissionMode(mode as SendTurnInput["runtimeMode"]))).toEqual(["default", "acceptEdits", "auto", "bypassPermissions"]);
    expect(permissionMode("full-access", "plan")).toBe("plan");
  });
  it("uses the native allowed boolean and preserves string request IDs", () => {
    const response = permissionResponse("perm_123_9", true, { file_path: "/project/a" });
    expect(response.response).toMatchObject({ request_id: "perm_123_9", response: { allowed: true, updatedInput: { file_path: "/project/a" } } });
    expect(response.response.response).not.toHaveProperty("behavior");
    expect(permissionResponse("perm_deny", false).response.response.allowed).toBe(false);
    expect(control("init", { subtype: "initialize", capabilities: { askUserQuestion: true } }).request.capabilities.askUserQuestion).toBe(true);
  });
  it("round-trips single, multiple and custom answers using native prompt keys", () => {
    const native = { questions: [
      { question: "Pick one", options: [{ label: "A" }, { label: "B" }] },
      { question: "Pick several", multiSelect: true, options: [{ label: "Red" }, { label: "Blue" }] },
      { question: "Custom", options: [{ label: "Preset" }, { label: "Other" }] },
    ] };
    expect(questions(native).map(q => q.allowCustom)).toEqual([true, true, true]);
    expect(questionInput(native, { kind: "answered", answers: { "Pick one": ["1"], "Pick several": ["0", "1"], Custom: ["__custom__"] }, custom: { Custom: "my choice" } })?.answers).toEqual({ "Pick one": "B", "Pick several": "Red, Blue", Custom: "my choice" });
    expect(questionInput(native, { kind: "skipped" })).toBeUndefined();
  });
  it("sends image bytes instead of pretending a path is vision input", () => {
    const image = { id: "image", kind: "image" as const, name: "input.png", mimeType: "image/png", size: 3, data: "YWJj" };
    expect(userMessage({ text: "describe", attachments: [image] }, "u").message.content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } });
    expect(() => userMessage({ text: "describe", attachments: [{ ...image, data: undefined, path: "/input.png" }] }, "u")).toThrow();
  });
  it("identifies native resume replay without dropping fresh messages", () => {
    expect(isHistorical({ __timestamp: "2026-10-19T00:00:00Z" }, Date.parse("2026-10-19T00:00:01Z"))).toBe(true);
    expect(isHistorical({ __timestamp: "2026-10-19T00:00:02Z" }, Date.parse("2026-10-19T00:00:01Z"))).toBe(false);
    expect(isHistorical({}, Date.now())).toBe(false);
  });
});
