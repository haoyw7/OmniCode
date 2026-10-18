const key = (endpoint: string) => `monocode.mobile.lastOnline:${endpoint}`;

/** When this phone last reached a paired device; device-local, never sent to a Host. */
export function loadLastOnline(endpoint: string | undefined): number | undefined {
  if (!endpoint) return undefined;
  try {
    const value = Number(localStorage.getItem(key(endpoint)));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveLastOnline(endpoint: string, at = Date.now()) {
  try {
    localStorage.setItem(key(endpoint), String(at));
  } catch {
    // Only a display hint; an unavailable store loses nothing else.
  }
}
