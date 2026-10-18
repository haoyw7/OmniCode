import { fileURLToPath } from "node:url";
import { evalDataPath } from "../src/evalData";
import { it as testIt, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { CaseSchema } from "../src/schema";
import { Environment } from "../src/environment";
import { evaluate } from "../src/scoring";
import { parsePiOutput } from "../src/adapters";
const evalRoot = fileURLToPath(new URL("..", import.meta.url));
const originalsAvailable = existsSync(
  evalDataPath(evalRoot, "data/cases.jsonl"),
);
const it = testIt.skipIf(!originalsAvailable);
const cases = originalsAvailable
  ? readFileSync(evalDataPath(evalRoot, "data/cases.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => CaseSchema.parse(JSON.parse(l)))
  : [];
const get = (id: string) => cases.find((c) => c.id === id)!;
it("does not accept 300 as a sum of 30", () => {
  const c = get("spreadsheets-sum"),
    e = new Environment(c, 17);
  e.call({
    action: "fixture.sheet.read",
    requestId: "r",
    input: { sheet: "sales" },
  });
  expect(evaluate(c, e, "300").passed).toBe(false);
});
it("requires the actual expiring fact, not only the expiry date", () => {
  const c = get("memory-expiry"),
    e = new Environment(c, 17);
  e.call({
    action: "memory.add",
    requestId: "r",
    input: { fact: "User hates tea.", until: "2026-10-12" },
  });
  expect(evaluate(c, e, "Noted").passed).toBe(false);
});
it("requires correct retry content as well as idempotent count", () => {
  const c = get("reliability-memory-retry"),
    e = new Environment(c, 17);
  const call = {
    action: "memory.add",
    requestId: "r",
    input: { fact: "User hates tea." },
  };
  e.call(call);
  e.call(call);
  expect(evaluate(c, e, "Noted").passed).toBe(false);
});
it("accepts equivalent scoped delegation wording", () => {
  const c = get("delegation-no-cross-scope-copy"),
    e = new Environment(c, 17);
  for (const [id, scope] of [
    ["s1", "API"],
    ["s2", "UI"],
  ])
    e.call({
      action: "sessions.send",
      requestId: id,
      input: {
        projectId: "p1",
        sessionId: id,
        text: `Please inspect only the ${scope} and make no file changes.`,
      },
    });
  expect(evaluate(c, e, "Dispatched").passed).toBe(true);
});
it("keeps missing Pi provider identity missing rather than using a fake identifier", () => {
  const output = JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      stopReason: "stop",
      usage: {},
    },
  });
  expect(parsePiOutput(output, 1).usage.models).toEqual([]);
});
it("numeric citation evidence cannot validate a different larger numeric answer", () => {
  const c = get("retrieval-conflict"),
    e = new Environment(c, 17);
  e.call({ action: "fixture.read", requestId: "old", input: { id: "old" } });
  e.call({
    action: "fixture.read",
    requestId: "current",
    input: { id: "current" },
  });
  expect(
    evaluate(c, e, "The cap increased from 100 to 1500 [current].").passed,
  ).toBe(false);
});

it("Pi delta and completed snapshots contribute only the last completed assistant message", () => {
  const first = {
    role: "assistant",
    content: [{ type: "text", text: '{"calls":[]}' }],
    stopReason: "stop",
    usage: {},
  };
  const last = {
    role: "assistant",
    content: [{ type: "text", text: '{"final":"22"}' }],
    stopReason: "stop",
    usage: {},
  };
  const output = [
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: '{"final":' },
    },
    { type: "message_end", message: first },
    { type: "message_end", message: last },
    { type: "agent_end", messages: [first, last] },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  expect(parsePiOutput(output, 1).text).toBe('{"final":"22"}');
});
