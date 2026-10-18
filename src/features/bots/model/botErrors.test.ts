import { expect, it } from "vitest";
import { botErrorMessage } from "./botErrors";

it("maps bridge and transport failures while keeping Host errors intact", () => {
  expect(botErrorMessage("Unsupported remote operation")).toMatch(
    /Update OmniCode/,
  );
  expect(
    botErrorMessage(
      "Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
    ),
  ).toBe("Cannot reach the Host. Check the connection and retry.");
  expect(botErrorMessage(new Error("Host rejected request: conflict"))).toBe(
    "Host rejected request: conflict",
  );
});
