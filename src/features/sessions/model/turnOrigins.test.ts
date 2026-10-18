import { expect, it } from "vitest";
import { retainTurnOrigins } from "./turnOrigins";
import type { Block, TurnOrigin } from "./session";
const origin: TurnOrigin = {
  kind: "assistant",
  assistantId: "a",
  assistantName: "小团",
  actionId: "act",
  wakeupId: "w",
};
const user = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  role: "user",
  text: "same text",
  ...extra,
});
it("preserves origin only for a proven stable message or provider turn ID", () => {
  const result = retainTurnOrigins(
    [user("host", { origin, providerTurnId: "turn" })],
    [user("native", { providerTurnId: "turn" }), user("human")],
  );
  expect(result).toHaveLength(2);
  expect(result[0].origin).toEqual(origin);
  expect(result[1].origin).toBeUndefined();
});
it("does not guess from text or accept an origin forged in a native file", () => {
  const result = retainTurnOrigins(
    [user("host", { origin })],
    [user("human", { origin })],
  );
  expect(result[0].origin).toBeUndefined();
  expect(result[1]).toEqual(user("host", { origin }));
});
