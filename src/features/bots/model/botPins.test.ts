// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readBotPins, writeBotPins } from "./botPins";
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("persists order independently for Hosts and survives a reader reload", () => {
  writeBotPins("one", ["b", "a"]); writeBotPins("two", ["a"]);
  expect(readBotPins("one")).toEqual(["b", "a"]); expect(readBotPins("two")).toEqual(["a"]);
  writeBotPins("one", ["a"]); expect(readBotPins("two")).toEqual(["a"]);
});
it("tolerates blocked storage and malformed or duplicate saved values", () => {
  localStorage.setItem("monocode.bot-pins:host", '["a",4,"a",null,"b"]');
  expect(readBotPins("host")).toEqual(["a", "b"]);
  localStorage.setItem("monocode.bot-pins:host", "invalid"); expect(readBotPins("host")).toEqual([]);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
  expect(readBotPins("host")).toEqual([]); expect(() => writeBotPins("host", ["a"])).not.toThrow();
});
