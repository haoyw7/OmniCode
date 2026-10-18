const KEY = "monocode.updatePreferences";

export type UpdatePreferences = {
  autoInstall: boolean;
  skippedVersion: string | null;
};

export function loadUpdatePreferences(): UpdatePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      autoInstall: value?.autoInstall === true,
      skippedVersion:
        typeof value?.skippedVersion === "string" ? value.skippedVersion : null,
    };
  } catch {
    return { autoInstall: false, skippedVersion: null };
  }
}

export function saveUpdatePreferences(
  changes: Partial<UpdatePreferences>,
): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...loadUpdatePreferences(), ...changes }),
    );
  } catch {
    // Storage may be unavailable; updates still work for the current session.
  }
}
