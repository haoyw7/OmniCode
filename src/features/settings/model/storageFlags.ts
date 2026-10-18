import { preferenceStorage } from "./sharedPreferences";
export function readFlag(key: string): boolean | null {
  try {
    const raw = preferenceStorage.getItem(key);
    if (raw == null) return null;
    return raw === "1" || raw === "true";
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    preferenceStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}
