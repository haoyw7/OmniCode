import { useStore } from "zustand";
import { preferenceStorage } from "./sharedPreferences";

const SHOW_REMAINING_USAGE_KEY = "omnicode.showRemainingUsage";
const MASK_EMAILS_KEY = "omnicode.maskEmails";

export const SHOW_REMAINING_USAGE_DEFAULT = false;
export const MASK_EMAILS_DEFAULT = true;

/** Fired on `window` whenever the usage meter direction flips (detail: boolean). */
export const SHOW_REMAINING_USAGE_CHANGE_EVENT =
  "omnicode:showremainingusagechange";
/** Fired on `window` whenever email masking flips (detail: boolean). */
export const MASK_EMAILS_CHANGE_EVENT = "omnicode:maskemailschange";

function flagStore(key: string, fallback: boolean, event: string) {
  const decode = (raw: string | null) => raw === null ? fallback : raw === "1" || raw === "true";
  const load = () => {
    try { return decode(preferenceStorage.getItem(key)); } catch { return fallback; }
  };
  const save = (value: boolean) => {
    try { preferenceStorage.setItem(key, value ? "1" : "0", true); } catch { /* Keep this window usable. */ }
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<boolean>(event, { detail: value }));
  };
  const subscribe = (onStoreChange: () => void) => preferenceStorage.subscribe([key], onStoreChange);
  const useFlag = () => useStore(preferenceStorage.store(key), state => decode(state.value));
  return { load, save, subscribe, useFlag };
}

const showRemainingUsage = flagStore(
  SHOW_REMAINING_USAGE_KEY,
  SHOW_REMAINING_USAGE_DEFAULT,
  SHOW_REMAINING_USAGE_CHANGE_EVENT,
);
const maskEmails = flagStore(
  MASK_EMAILS_KEY,
  MASK_EMAILS_DEFAULT,
  MASK_EMAILS_CHANGE_EVENT,
);

/** Usage meters fill with what is left instead of what is used. */
export const loadShowRemainingUsage = showRemainingUsage.load;
export const saveShowRemainingUsage = showRemainingUsage.save;
export const subscribeShowRemainingUsage = showRemainingUsage.subscribe;
export const useShowRemainingUsage = showRemainingUsage.useFlag;

/** Account emails stay blurred until clicked. */
export const loadMaskEmails = maskEmails.load;
export const saveMaskEmails = maskEmails.save;
export const subscribeMaskEmails = maskEmails.subscribe;
export const useMaskEmails = maskEmails.useFlag;
