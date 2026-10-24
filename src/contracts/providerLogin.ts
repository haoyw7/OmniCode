/** Additional single-account CLI login flows owned by the execution Host. */
export const HOST_PROVIDER_LOGIN_CAPABILITY = "providers.login.v1";

export type HostLoginProvider = "cursor" | "grok" | "fx";
export type HostProviderLoginStatus = {
  id: string;
  status: "running" | "succeeded" | "failed";
  error?: string;
};
