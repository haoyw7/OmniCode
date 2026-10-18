import { describe, expect, it } from "vitest";
import { parseModelTurn } from "../src/transport";
const strict = { version: "envelope-strict-v1" as const };
const compatible = { version: "terminal-compatible-v2" as const };
const call = { action: "memory.add", requestId: "r", input: { fact: "hello" } };
describe("versioned model turn transport", () => {
  it.each(["", " "])("calls with blank final %j continue", (final) => {
    expect(
      parseModelTurn(JSON.stringify({ calls: [call], final }), compatible),
    ).toEqual({ kind: "calls", calls: [call] });
  });
  it("rejects calls combined with a substantive final", () => {
    expect(() =>
      parseModelTurn(
        JSON.stringify({ calls: [call], final: "done" }),
        compatible,
      ),
    ).toThrow("INVALID_MODEL_OUTPUT");
  });
  it.each(["", " "])("rejects an empty final %j", (final) => {
    expect(() => parseModelTurn(JSON.stringify({ final }), compatible)).toThrow(
      "EMPTY_FINAL",
    );
  });
  it.each([
    "22",
    "中文回答。",
    "The unavailable tool prevents completion.",
    '{"answer":"$22"}',
  ])("replays terminal content under declared policy: %s", (text) => {
    expect(parseModelTurn(text, compatible)).toEqual({
      kind: "final",
      final: text,
      transport: "raw-terminal",
    });
    expect(() => parseModelTurn(text, strict)).toThrow("INVALID_MODEL_OUTPUT");
  });
  it.each([
    '{"calls":[{"action":"memory.add","requestId":"r","input":{"fact":"x"}}]',
    '{"final":"a"}{"final":"b"}',
    '{"calls":[],"calls":[{"action":"memory.add","requestId":"r","input":{"fact":"x"}}]}',
    '{"final":"ok","final":"bad"}',
    '{"calls":[{"action":"memory.add","requestId":"r","input":{"fact":"x","fact":"y"}}]}',
    '{"final":1}',
    '{"calls":"bad"}',
    '{"calls":[]}',
    JSON.stringify({ calls: Array(9).fill(call) }),
    '{"calls":[{"action":"x","requestId":"r","input":null}]}',
  ])("never falls back from a malformed envelope: %s", (text) => {
    expect(() => parseModelTurn(text, compatible)).toThrow(
      "INVALID_MODEL_OUTPUT",
    );
  });
  it("rejects undeclared raw policy and accepts exact JSON envelope", () => {
    expect(() => parseModelTurn("hello", strict)).toThrow(
      "INVALID_MODEL_OUTPUT",
    );
    expect(parseModelTurn('{"final":"hello"}', strict)).toEqual({
      kind: "final",
      final: "hello",
      transport: "json-envelope",
    });
  });
});
