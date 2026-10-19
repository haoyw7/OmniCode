import { preferenceStorage } from "../../settings/model/sharedPreferences";

/** How the review renders each file's diff; shared by every review tab. */
export type ReviewViewOptions = {
  sideBySide: boolean;
  wordWrap: boolean;
  highlightWords: boolean;
};

const KEY = "omnicode.reviewViewOptions.v1";

export const REVIEW_VIEW_DEFAULTS: ReviewViewOptions = {
  sideBySide: false,
  wordWrap: true,
  highlightWords: true,
};

export function loadReviewViewOptions(): ReviewViewOptions {
  try {
    const parsed: unknown = JSON.parse(preferenceStorage.getItem(KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return REVIEW_VIEW_DEFAULTS;
    const stored = parsed as Partial<Record<keyof ReviewViewOptions, unknown>>;
    const flag = (key: keyof ReviewViewOptions) =>
      typeof stored[key] === "boolean" ? stored[key] : REVIEW_VIEW_DEFAULTS[key];
    return {
      sideBySide: flag("sideBySide"),
      wordWrap: flag("wordWrap"),
      highlightWords: flag("highlightWords"),
    };
  } catch {
    return REVIEW_VIEW_DEFAULTS;
  }
}

export function saveReviewViewOptions(options: ReviewViewOptions): void {
  try {
    preferenceStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // private mode / quota
  }
}
