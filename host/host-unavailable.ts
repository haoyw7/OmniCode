/** Raised when the Host cannot run a request now but nothing was applied. */
export class HostUnavailableError extends Error {}

// Existing lifecycle guards throw these exact messages from several backends.
const TRANSIENT = new Set(["Host is stopping", "Host is not ready"]);

/** Temporary unavailability is retryable; every other failure stays a definitive rejection. */
export function isHostUnavailable(error: unknown): boolean {
  return error instanceof HostUnavailableError || (error instanceof Error && TRANSIENT.has(error.message));
}
