/** Robot onboarding used by @larksuite/openclaw-lark-tools (1.0.47).
 * This registers a personal bot, unlike OAuth login for an existing application.
 */
const endpoint = "https://accounts.feishu.cn/oauth/v1/app/registration";

export type FeishuRegistrationAttempt = {
  deviceCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
};
export type FeishuRegistrationResult =
  | { state: "pending" | "slow_down" | "cancelled" | "expired" }
  | { state: "complete"; appId: string; appSecret: string; ownerOpenId: string };
export interface FeishuRegistrationClient {
  begin(signal: AbortSignal): Promise<FeishuRegistrationAttempt>;
  poll(deviceCode: string, signal: AbortSignal): Promise<FeishuRegistrationResult>;
}

/** Only fixed messages from this provider may be shown outside the Host. */
export class FeishuRegistrationError extends Error {}

export class FeishuRegistration implements FeishuRegistrationClient {
  constructor(private requestFetch: typeof fetch = fetch) {}

  private async request(params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
    let data: unknown;
    try {
      const response = await this.requestFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        redirect: "error",
      });
      data = await response.json();
      if (!response.ok && !(data && typeof data === "object" && "error" in data))
        throw new Error();
    } catch {
      // Never expose an upstream response, URL, device code or credential in errors.
      throw new FeishuRegistrationError("Could not reach Feishu. Try again.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new FeishuRegistrationError("Feishu returned an invalid binding response.");
    return data as Record<string, unknown>;
  }

  async begin(signal: AbortSignal): Promise<FeishuRegistrationAttempt> {
    const init = await this.request({ action: "init" }, signal);
    if (!Array.isArray(init.supported_auth_methods) || !init.supported_auth_methods.includes("client_secret"))
      throw new FeishuRegistrationError("Feishu browser binding is unavailable. Try again later.");
    const data = await this.request({
      action: "begin", archetype: "PersonalAgent", auth_method: "client_secret", request_user_info: "open_id",
    }, signal);
    const url = typeof data.verification_uri_complete === "string" ? data.verification_uri_complete : data.verification_uri;
    let verificationUrl: URL;
    try {
      verificationUrl = new URL(String(url));
      if (verificationUrl.protocol !== "https:" || !["accounts.feishu.cn", "open.feishu.cn"].includes(verificationUrl.hostname) ||
          verificationUrl.username || verificationUrl.password || verificationUrl.port) throw new Error();
    } catch { throw new FeishuRegistrationError("Feishu returned an invalid binding response."); }
    if (typeof data.device_code !== "string" || !data.device_code || data.device_code.length > 4096)
      throw new FeishuRegistrationError("Feishu returned an invalid binding response.");
    const lifetime = data.expire_in ?? data.expires_in ?? 600;
    const interval = data.interval ?? 5;
    if (typeof lifetime !== "number" || !Number.isFinite(lifetime) || lifetime <= 0 ||
        typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0)
      throw new FeishuRegistrationError("Feishu returned an invalid binding response.");
    return {
      deviceCode: data.device_code,
      verificationUrl: verificationUrl.toString(),
      interval: Math.max(1000, interval * 1000),
      expiresAt: Date.now() + Math.min(lifetime, 3600) * 1000,
    };
  }

  async poll(deviceCode: string, signal: AbortSignal): Promise<FeishuRegistrationResult> {
    const data = await this.request({ action: "poll", device_code: deviceCode }, signal);
    const user = data.user_info as { open_id?: unknown; tenant_brand?: unknown } | undefined;
    if (user?.tenant_brand === "lark") throw new FeishuRegistrationError("Use a Feishu account to bind this assistant.");
    if (data.error) {
      switch (data.error) {
        case "authorization_pending": return { state: "pending" };
        case "slow_down": return { state: "slow_down" };
        case "access_denied": return { state: "cancelled" };
        case "expired_token": return { state: "expired" };
        default: throw new FeishuRegistrationError("Feishu binding failed. Try again.");
      }
    }
    if (typeof data.client_id !== "string" || !/^cli_[0-9a-fA-F]{16}$/.test(data.client_id) ||
        typeof data.client_secret !== "string" || !data.client_secret.trim() || data.client_secret.length > 2048 ||
        typeof user?.open_id !== "string" || !/^ou_[\w-]+$/.test(user.open_id))
      throw new FeishuRegistrationError("Feishu returned an invalid binding response.");
    return { state: "complete", appId: data.client_id, appSecret: data.client_secret.trim(), ownerOpenId: user.open_id };
  }
}
