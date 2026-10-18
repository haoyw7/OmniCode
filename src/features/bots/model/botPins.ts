const key = (environmentId: string) => `monocode.bot-pins:${environmentId}`;

/** A local, ordered preference; never part of the Host protocol. */
export function readBotPins(environmentId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(environmentId)) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && !!id))] : [];
  } catch { return []; }
}
export function writeBotPins(environmentId: string, ids: readonly string[]) {
  try { localStorage.setItem(key(environmentId), JSON.stringify(ids)); }
  catch { /* The workspace retains this preference in memory. */ }
}
