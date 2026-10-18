// Remembers the last conversation and the default project for a new chat.
// Launch opens Home. Only identifiers are stored; credentials stay in mobileStorage.
export interface MobileLocation {
  environmentId: string;
  projectId: string;
  sessionId?: string;
}

export const LAST_LOCATION_KEY = "monocode-mobile-last";

export function readLastLocation(
  environmentId: string | undefined,
): MobileLocation | undefined {
  if (!environmentId) return undefined;
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(LAST_LOCATION_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return undefined;
    const location = value as Partial<MobileLocation>;
    if (
      location.environmentId !== environmentId ||
      typeof location.projectId !== "string" ||
      (location.sessionId !== undefined &&
        typeof location.sessionId !== "string")
    )
      return undefined;
    return {
      environmentId,
      projectId: location.projectId,
      ...(location.sessionId ? { sessionId: location.sessionId } : {}),
    };
  } catch {
    return undefined;
  }
}

export function saveLastLocation(location: MobileLocation) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(location));
  } catch {
    // Private or restricted storage only loses the launch shortcut.
  }
}
