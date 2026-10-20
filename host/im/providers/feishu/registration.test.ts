import { expect, it, vi } from "vitest";
import { FeishuRegistration } from "./registration";

const endpoint = "https://accounts.feishu.cn/oauth/v1/app/registration";
const url = `${endpoint}?user_code=public-code`;
const signal = new AbortController().signal;
const begin = { device_code: "host-only-device-code", verification_uri_complete: url, interval: 5, expire_in: 600 };
function fixture(...responses: Array<unknown>) {
  const request = vi.fn<typeof fetch>();
  for (const response of responses) request.mockResolvedValueOnce(new Response(JSON.stringify(response)));
  return { client: new FeishuRegistration(request), request };
}

it("requests personal-bot registration and the authorized open_id, without an existing app or redirect server", async () => {
  const { client, request } = fixture({ supported_auth_methods: ["client_secret"] }, begin);
  const startedAt = Date.now();
  const attempt = await client.begin(signal);
  expect(attempt).toMatchObject({ deviceCode: begin.device_code, verificationUrl: url, interval: 5000 });
  expect(attempt.expiresAt).toBeGreaterThanOrEqual(startedAt + 600_000);
  const [target, options] = request.mock.calls[1];
  expect(target).toBe(endpoint);
  expect(options).toMatchObject({ method: "POST", redirect: "error" });
  expect(Object.fromEntries(options!.body as URLSearchParams)).toEqual({
    action: "begin", archetype: "PersonalAgent", auth_method: "client_secret", request_user_info: "open_id",
  });
});

it.each(["http://accounts.feishu.cn/authorize", "https://accounts.feishu.cn.evil.test/authorize", "javascript:alert(1)"])(
  "rejects an untrusted authorization URL (%s)", async (verification_uri_complete) => {
    const { client } = fixture({ supported_auth_methods: ["client_secret"] }, { ...begin, verification_uri_complete });
    await expect(client.begin(signal)).rejects.toThrow("invalid binding response");
  },
);

it("accepts the official Open Platform launcher returned by live registration", async () => {
  const launcher = "https://open.feishu.cn/page/launcher?user_code=public-code";
  const { client } = fixture({ supported_auth_methods: ["client_secret"] }, {
    device_code: begin.device_code, verification_uri_complete: launcher, interval: 5, expires_in: 3600,
  });
  const startedAt = Date.now();
  const attempt = await client.begin(signal);
  expect(attempt.verificationUrl).toBe(launcher);
  expect(attempt.expiresAt).toBeGreaterThanOrEqual(startedAt + 3600_000);
});

it.each([
  ["authorization_pending", "pending"], ["slow_down", "slow_down"], ["access_denied", "cancelled"], ["expired_token", "expired"],
])("maps %s without returning the provider payload", async (error, state) => {
  const { client } = fixture({ error, error_description: "Do not expose this" });
  expect(await client.poll(begin.device_code, signal)).toEqual({ state });
});

it("reads credentials and owner identity from the same successful registration", async () => {
  const { client, request } = fixture({ client_id: "cli_1234567890abcdef", client_secret: " private-secret ", user_info: { open_id: "ou_owner", tenant_brand: "feishu" } });
  expect(await client.poll(begin.device_code, signal)).toEqual({
    state: "complete", appId: "cli_1234567890abcdef", appSecret: "private-secret", ownerOpenId: "ou_owner",
  });
  expect(Object.fromEntries(request.mock.calls[0][1]!.body as URLSearchParams)).toEqual({ action: "poll", device_code: begin.device_code });
});

it.each([{}, { open_id: "not-an-open-id" }, { open_id: "ou_owner", tenant_brand: "lark" }])(
  "rejects a missing or incompatible authorized identity (%j)", async (user_info) => {
    const { client } = fixture({ client_id: "cli_1234567890abcdef", client_secret: "private-secret", user_info });
    await expect(client.poll(begin.device_code, signal)).rejects.toThrow();
  },
);

it("does not expose credentials or device codes in upstream errors", async () => {
  const { client, request } = fixture({ error: "unknown", error_description: "private-secret host-only-device-code", client_secret: "private-secret" });
  await expect(client.poll(begin.device_code, signal)).rejects.toThrow("Feishu binding failed. Try again.");
  request.mockRejectedValueOnce(new Error("private-secret host-only-device-code"));
  await expect(client.poll(begin.device_code, signal)).rejects.toThrow("Could not reach Feishu. Try again.");
});

it("passes cancellation to the request signal", async () => {
  const controller = new AbortController();
  const { client, request } = fixture({ error: "authorization_pending" });
  await client.poll(begin.device_code, controller.signal);
  const requestSignal = request.mock.calls[0][1]!.signal!;
  expect(requestSignal.aborted).toBe(false);
  controller.abort();
  expect(requestSignal.aborted).toBe(true);
});
