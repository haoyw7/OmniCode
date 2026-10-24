import { Capacitor, CapacitorHttp } from "@capacitor/core";

const RPC_TIMEOUT_MS = 20_000;

export type RpcTransport = (
  endpoint: string,
  token: string,
  request: object,
  options?: { timeoutMs?: number },
) => Promise<unknown>;
export class HostRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const nativeTransport: RpcTransport = async (
  endpoint,
  token,
  request,
  { timeoutMs = RPC_TIMEOUT_MS } = {},
) => {
  let status: number;
  let data: unknown;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url: `${endpoint}/rpc`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: request,
      connectTimeout: 10_000,
      readTimeout: timeoutMs,
      disableRedirects: true,
      responseType: "json",
    });
    status = response.status;
    data = response.data;
  } else if (import.meta.env.DEV) {
    const response = await fetch("/__mobile/rpc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint, request, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    data = await response.json();
  } else {
    throw new Error("Open OmniCode on iOS or Android to connect to a Host.");
  }
  if (typeof data === "string") data = JSON.parse(data);
  if (status < 200 || status >= 300) {
    const message = (data as { error?: string })?.error;
    throw new HostRequestError(
      message || `Host request failed (${status})`,
      status,
    );
  }
  if (!data || typeof data !== "object" || !("result" in data))
    throw new Error("Invalid Host response.");
  return (data as { result: unknown }).result;
};

