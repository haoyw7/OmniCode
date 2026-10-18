import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "../../platform/tauri/platform";
import chinese from "./zh-CN.json";
import {
  getUiLanguage,
  refreshUiLanguage,
  setUiLanguage,
  subscribeUiLanguage,
  type UiLanguage,
} from "./language";

const LANGUAGE_EVENT = "monocode-ui-language-changed";
let nativeMenuUpdate = Promise.resolve();

function syncNativeMenu() {
  if (!IS_MAC) return;
  // Serialize rapid switches so an older native menu cannot win a race.
  nativeMenuUpdate = nativeMenuUpdate
    .catch(() => undefined)
    .then(() =>
      invoke<void>("menu_set_language", {
        labels: getUiLanguage() === "zh-CN" ? chinese : {},
      }),
    );
  void nativeMenuUpdate.catch(() => undefined);
}

/** Called once by each workspace/quick-composer entry point. */
export function initUiLanguage() {
  refreshUiLanguage();
  syncNativeMenu();
  let receiving = false;
  const unsubscribe = subscribeUiLanguage(() => {
    syncNativeMenu();
    if (!receiving)
      void emit(LANGUAGE_EVENT, getUiLanguage()).catch(() => undefined);
  });
  const listening = listen<UiLanguage>(LANGUAGE_EVENT, ({ payload }) => {
    if (payload !== "en" && payload !== "zh-CN") return;
    receiving = true;
    try {
      setUiLanguage(payload);
    } finally {
      receiving = false;
    }
  });
  void listening.catch(() => undefined);
  return () => {
    unsubscribe();
    void listening.then((unlisten) => unlisten()).catch(() => undefined);
  };
}
