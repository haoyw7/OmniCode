import { useCallback, useSyncExternalStore } from "react";
import {
  getUiLanguage,
  subscribeUiLanguage,
  translate,
  type TranslationValues,
} from "./language";

export function useTranslation() {
  const language = useSyncExternalStore(
    subscribeUiLanguage,
    getUiLanguage,
    () => "en" as const,
  );
  const t = useCallback(
    (text: string, values?: TranslationValues) =>
      translate(text, values, language),
    [language],
  );
  return { language, t };
}
