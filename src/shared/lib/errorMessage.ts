/** Native IPC can reject with a string as well as an Error. */
export function errorMessage(error: unknown): string | undefined {
  return error == null ? undefined : error instanceof Error ? error.message : String(error);
}
