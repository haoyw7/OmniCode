


/** Statuses a provider uses for a call that did not work. */
export function isFailedStatus(status?: string): boolean {
  const value = status?.toLowerCase() ?? "";
  return (
    value === "failed" ||
    value === "error" ||
    value === "cancelled" ||
    value === "canceled"
  );
}