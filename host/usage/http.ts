/** Authenticated requests never forward credentials through redirects. */
export async function usageJson(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Usage request failed (${response.status})`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid usage response");
  return value as Record<string, unknown>;
}
