// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { fetchCodexRateLimits, fetchClaudeRateLimits, fetchOpencodeGoRateLimits, consumeCodexRateLimitResetCredit } from "./rateLimitsFetch";
afterEach(() => configureSharedHost(undefined, []));
it("reports a disconnected Host without accessing local provider credentials or launching a CLI", async () => {
  configureSharedHost(undefined, []);
  for (const read of [fetchCodexRateLimits, fetchClaudeRateLimits, fetchOpencodeGoRateLimits])
    expect(await read()).toMatchObject({ status: "unavailable", error: expect.stringContaining("Connect to the shared Host") });
  await expect(consumeCodexRateLimitResetCredit()).rejects.toThrow("Connect to the shared Host");
});
