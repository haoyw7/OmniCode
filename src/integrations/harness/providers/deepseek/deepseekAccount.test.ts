import { expect, it } from "vitest";
import { parseDeepseekAccount } from "./deepseekAccount";

it("projects only public account fields and preserves decimal wallet precision", () => {
  const result = parseDeepseekAccount({ status: "credential-stored", token: "private-token", requestHeaders: { secret: "private-header" },
    profileStatus: "ready", profile: { name: " User ", contact: "u***@example.test", id: "private-id", token: "private-token" },
    balanceStatus: "ready", wallets: [{ currency: "CNY", balance: "1.234567890123456789", token: "private-token" },
      { currency: "USD", balance: "0.00" }, { currency: "USD", balance: "invalid" }], bonusWallets: [] });
  expect(result.profile).toEqual({ name: "User", contact: "u***@example.test" });
  expect(result.wallets).toEqual([{ currency: "CNY", balance: "1.234567890123456789" }, { currency: "USD", balance: "0.00" }]);
  expect(JSON.stringify(result)).not.toContain("private-");
});

it("drops stale profile and wallet fields when signed out", () => {
  expect(parseDeepseekAccount({ status: "signed-out", profile: { name: "Old user" }, wallets: [{ currency: "USD", balance: "3" }] }))
    .toEqual({ status: "signed-out" });
  expect(() => parseDeepseekAccount(null)).toThrow("Invalid DeepSeek account response");
});
