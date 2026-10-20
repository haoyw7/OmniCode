/** Parse DSH's provider/model identity without changing either component. */
export function parseDeepseekModelRoute(model: string): [string, string] | undefined {
  try {
    const route: unknown = JSON.parse(model.replace(/^deepseek:/, ""));
    if (Array.isArray(route) && route.length === 2 &&
        route.every(value => typeof value === "string" && value))
      return route as [string, string];
  } catch {
    // Legacy/default selections are not encoded routes.
  }
  return undefined;
}
