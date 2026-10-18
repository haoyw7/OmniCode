// Monocode shim: dynamic workflows are always available on a Host.
export function useDynamicWorkflowAvailability(): { enabled: boolean } {
  return { enabled: true };
}
